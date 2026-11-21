//! 本地模型助手：把工作台上下文交给本机 OpenAI 兼容服务。
//!
//! 设计约束（与产品定位一致）：
//! - **只连回环地址**：模型服务必须跑在同一台机器上（127.0.0.1 / localhost / ::1）。
//!   这里不是可配置项，而是硬校验：助手能读任务、端口、成本与知识库，
//!   允许把 base_url 指向公网等于给远端一个免认证的数据出口。
//! - **不内置密钥、不落盘**：本地服务通常不需要 Key；即便需要，也只放在请求头里。
//! - **工具调用有上限**：最多 4 轮、单条结果截断到 3000 字符，超限明确报错，
//!   不让一个 2B 模型把界面拖到无响应。
//! - **写入复用现有闸门**：创建任务走 `services::ai::task_create`，
//!   与 MCP 写入共用 `ai.json` 开关、同一份审计与撤销记录。

use crate::cost_store;
use crate::data;
use crate::json_store;
use crate::knowledge;
use crate::paths::DataRoot;
use crate::runtime;
use crate::services::ai::{self as ai_service, TaskCreateArgs};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// 默认端点：本机 llama.cpp / Ollama 一类 OpenAI 兼容服务的常见起点。
pub const DEFAULT_BASE_URL: &str = "http://127.0.0.1:18082/v1";
/// 默认模型：MiniCPM5-2B（2B 稠密，Q4 约 1.5 GB，适合端侧）。
pub const DEFAULT_MODEL: &str = "minicpm5-2b";

const CONFIG_FILE: &str = "assistant.json";
/// 一次对话最多几轮工具调用。
const MAX_STEPS: usize = 4;
/// 一次对话最多执行几个工具（防止单轮塞进十几个调用）。
const MAX_TOOL_CALLS: usize = 8;
/// 单条工具结果最多保留多少字符（按字符而不是字节，中文不会被截成半个）。
const MAX_TOOL_RESULT_CHARS: usize = 3000;
/// 单条用户消息上限。
const MAX_MESSAGE_CHARS: usize = 4000;
/// 送进模型的历史消息条数上限。
const MAX_HISTORY: usize = 16;
/// 历史消息总字符预算。16 条 × 4000 字会远超 8k 上下文；
/// 这个预算保证系统提示 + 工具声明 + 历史 + 输出仍能塞进 8192 token。
const MAX_HISTORY_CHARS: usize = 4000;
/// 用户主动停止时的统一错误串，命令层据此发 `stopped` 而不是 `error`。
pub const STOPPED: &str = "已停止生成";
/// 单次 HTTP 请求上限。2B 在 CPU 上最慢约 7 token/s，4096 token 需要约 10 分钟；
/// 120 秒会把正常长文误判成超时。用户主动停止由 `cancel` 标志负责，不依赖这个上限。
const REQUEST_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Serialize, Deserialize, Clone, Debug, ts_rs::TS)]
pub struct AssistantConfig {
    /// OpenAI 兼容根地址，例如 `http://127.0.0.1:18082/v1`。
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    /// 是否让模型先输出思考过程。默认关闭：2B 在 CPU 上思考几十秒才能说正文，
    /// 工作台的问答不需要这么长的链路；打开后最大输出 token 要相应调高。
    #[serde(default)]
    pub thinking: bool,
    /// 可选的 llama-server 可执行文件路径；留空则只能手动起服务。
    #[serde(default)]
    pub server_bin: String,
    /// 可选的 GGUF 模型路径；与 `server_bin` 一起用于应用内启动。
    #[serde(default)]
    pub model_path: String,
    /// 应用内启动时的上下文长度。
    #[serde(default = "default_context_size")]
    pub context_size: u32,
}

fn default_base_url() -> String {
    DEFAULT_BASE_URL.to_string()
}
fn default_model() -> String {
    DEFAULT_MODEL.to_string()
}
fn default_temperature() -> f32 {
    0.2
}
fn default_max_tokens() -> u32 {
    1024
}
fn default_context_size() -> u32 {
    8192
}

impl Default for AssistantConfig {
    fn default() -> Self {
        Self {
            base_url: default_base_url(),
            model: default_model(),
            temperature: default_temperature(),
            max_tokens: default_max_tokens(),
            thinking: false,
            server_bin: String::new(),
            model_path: String::new(),
            context_size: default_context_size(),
        }
    }
}

#[derive(Serialize, Clone, Debug, ts_rs::TS)]
pub struct AssistantStatus {
    pub ok: bool,
    pub base_url: String,
    pub model: String,
    #[ts(type = "number")]
    pub latency_ms: u64,
    /// 服务实际报告的模型名（用于发现「配置名和服务对不上」）。
    pub models: Vec<String>,
    pub error: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, ts_rs::TS)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize, Clone, Debug, ts_rs::TS)]
pub struct AssistantStep {
    pub tool: String,
    pub arguments: String,
    pub result: String,
    pub ok: bool,
}

#[derive(Serialize, Clone, Debug, Default, ts_rs::TS)]
pub struct AssistantUsage {
    #[ts(type = "number")]
    pub prompt_tokens: u64,
    #[ts(type = "number")]
    pub completion_tokens: u64,
}

#[derive(Serialize, Clone, Debug, ts_rs::TS)]
pub struct AssistantReply {
    pub content: String,
    pub steps: Vec<AssistantStep>,
    pub usage: AssistantUsage,
    pub model: String,
}

/// 流式事件：`delta` 增量正文，`step` 工具完成，`done` 最终回复，
/// `error` 失败，`stopped` 用户取消。前端只按 `kind` 分派。
#[derive(Serialize, Clone, Debug, ts_rs::TS)]
pub struct AssistantEvent {
    pub kind: String,
    pub text: String,
    pub step: Option<AssistantStep>,
    pub reply: Option<AssistantReply>,
}

impl AssistantEvent {
    pub fn delta(text: impl Into<String>) -> Self {
        Self {
            kind: "delta".into(),
            text: text.into(),
            step: None,
            reply: None,
        }
    }
    pub fn step(step: AssistantStep) -> Self {
        Self {
            kind: "step".into(),
            text: String::new(),
            step: Some(step),
            reply: None,
        }
    }
    pub fn done(reply: AssistantReply) -> Self {
        Self {
            kind: "done".into(),
            text: String::new(),
            step: None,
            reply: Some(reply),
        }
    }
    pub fn error(message: impl Into<String>) -> Self {
        Self {
            kind: "error".into(),
            text: message.into(),
            step: None,
            reply: None,
        }
    }
    pub fn stopped() -> Self {
        Self {
            kind: "stopped".into(),
            text: STOPPED.into(),
            step: None,
            reply: None,
        }
    }
}

static CANCELS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

fn cancel_map() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    CANCELS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 登记一次流式请求的取消旗标；同一 id 覆盖旧值。
pub fn register_cancel(request_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    if !request_id.is_empty() {
        if let Ok(mut map) = cancel_map().lock() {
            map.insert(request_id.to_string(), flag.clone());
        }
    }
    flag
}

pub fn release_cancel(request_id: &str) {
    if !request_id.is_empty() {
        if let Ok(mut map) = cancel_map().lock() {
            map.remove(request_id);
        }
    }
}

/// 由前端「停止」按钮调用；只置位，不等待。
pub fn cancel(request_id: &str) {
    if let Ok(map) = cancel_map().lock() {
        if let Some(flag) = map.get(request_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

static SERVICE_CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

fn service_child() -> &'static Mutex<Option<Child>> {
    SERVICE_CHILD.get_or_init(|| Mutex::new(None))
}

/// 应用内启动 llama-server：只使用用户显式填写的本地可执行文件与 GGUF，
/// 不下载、不联网、不执行模型名拼出来的命令。
pub fn start_service(root: &DataRoot, config: AssistantConfig) -> Result<AssistantStatus, String> {
    let config = normalize_config(config)?;
    if config.server_bin.is_empty() || config.model_path.is_empty() {
        return Err("请先在模型设置里填写 llama-server 路径和 GGUF 模型路径".to_string());
    }
    let current = status(&config);
    if current.ok {
        return Ok(current);
    }
    let bin = std::path::Path::new(&config.server_bin);
    let model = std::path::Path::new(&config.model_path);
    if !bin.is_file() {
        return Err(format!("找不到 llama-server: {}", config.server_bin));
    }
    if !model.is_file() {
        return Err(format!("找不到模型文件: {}", config.model_path));
    }
    let port = reqwest::Url::parse(&config.base_url)
        .ok()
        .and_then(|u| u.port_or_known_default())
        .unwrap_or(18082);
    let log_path = root.join("assistant-service.log");
    let stdout = std::fs::File::create(&log_path)
        .map_err(|e| format!("无法创建服务日志 {}: {e}", log_path.display()))?;
    let stderr = stdout
        .try_clone()
        .map_err(|e| format!("无法复制服务日志句柄: {e}"))?;
    let mut guard = service_child()
        .lock()
        .map_err(|_| "服务状态锁被污染".to_string())?;
    if let Some(child) = guard.as_mut() {
        if child.try_wait().ok().flatten().is_none() {
            return Err("应用内启动的模型服务已经在运行".to_string());
        }
    }
    let child = Command::new(bin)
        .arg("-m")
        .arg(model)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("-c")
        .arg(config.context_size.to_string())
        .arg("--jinja")
        .arg("--parallel")
        .arg("1")
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|e| format!("启动 llama-server 失败: {e}"))?;
    *guard = Some(child);

    let started = Instant::now();
    loop {
        if started.elapsed() > Duration::from_secs(90) {
            drop(guard);
            let _ = stop_service();
            return Err("模型服务 90 秒内没有就绪，请查看 assistant-service.log".to_string());
        }
        std::thread::sleep(Duration::from_secs(1));
        let current = status(&config);
        if current.ok {
            return Ok(current);
        }
        if let Some(child) = guard.as_mut() {
            if let Ok(Some(exit)) = child.try_wait() {
                *guard = None;
                return Err(format!(
                    "模型服务启动后退出了（{exit}），请查看 {}",
                    log_path.display()
                ));
            }
        }
    }
}

pub fn stop_service() -> Result<bool, String> {
    let mut guard = service_child()
        .lock()
        .map_err(|_| "服务状态锁被污染".to_string())?;
    let Some(mut child) = guard.take() else {
        return Ok(false);
    };
    child.kill().map_err(|e| format!("停止模型服务失败: {e}"))?;
    let _ = child.wait();
    Ok(true)
}

pub fn load_config(root: &DataRoot) -> Result<AssistantConfig, String> {
    let raw = json_store::read_json::<AssistantConfig>(&root.join(CONFIG_FILE))?;
    Ok(raw.unwrap_or_default())
}

pub fn save_config(root: &DataRoot, config: AssistantConfig) -> Result<AssistantConfig, String> {
    let normalized = normalize_config(config)?;
    json_store::write_json_atomic(&root.join(CONFIG_FILE), &normalized)?;
    Ok(normalized)
}

/// 校验并规范化配置：端点必须是回环地址，参数必须落在可用区间。
pub fn normalize_config(mut config: AssistantConfig) -> Result<AssistantConfig, String> {
    config.base_url = normalize_base_url(&config.base_url)?;
    let model = config.model.trim();
    if model.is_empty() || model.chars().count() > 120 {
        return Err("模型名不能为空且不超过 120 字".to_string());
    }
    if model.chars().any(|c| c.is_control()) {
        return Err("模型名包含控制字符".to_string());
    }
    config.model = model.to_string();
    if !config.temperature.is_finite() || !(0.0..=2.0).contains(&config.temperature) {
        return Err("temperature 必须在 0 到 2 之间".to_string());
    }
    if !(64..=4096).contains(&config.max_tokens) {
        return Err("max_tokens 必须在 64 到 4096 之间".to_string());
    }
    if !(512..=32768).contains(&config.context_size) {
        return Err("context_size 必须在 512 到 32768 之间".to_string());
    }
    config.server_bin = config.server_bin.trim().to_string();
    config.model_path = config.model_path.trim().to_string();
    Ok(config)
}

/// 端点白名单：只接受 `http(s)://回环主机[:端口][/路径]`。
pub fn normalize_base_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    let raw = if trimmed.is_empty() {
        DEFAULT_BASE_URL
    } else {
        trimmed
    };
    let url = reqwest::Url::parse(raw).map_err(|e| format!("模型地址无法解析: {e}"))?;
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return Err("模型地址必须以 http:// 或 https:// 开头".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("模型地址不能包含用户名或密码".to_string());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("模型地址不能带查询参数或锚点".to_string());
    }
    let host = url
        .host_str()
        .map(|h| h.trim_matches(['[', ']']).to_ascii_lowercase())
        .ok_or_else(|| "模型地址缺少主机名".to_string())?;
    if !matches!(host.as_str(), "127.0.0.1" | "localhost" | "::1") {
        return Err(format!(
            "只允许连接本机模型服务（127.0.0.1 / localhost / ::1），拒绝 {host}"
        ));
    }
    let host_part = if host == "::1" {
        "[::1]".to_string()
    } else {
        host.clone()
    };
    let mut out = format!("{scheme}://{host_part}");
    if let Some(port) = url.port() {
        out.push_str(&format!(":{port}"));
    }
    let path = url.path().trim_end_matches('/');
    if !path.is_empty() && path != "/" {
        out.push_str(path);
    }
    Ok(out)
}

fn endpoint(base: &str, suffix: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), suffix)
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("创建模型客户端失败: {e}"))
}

/// 探测模型服务：返回是否可达、实际加载了哪些模型、往返延迟。
pub fn status(config: &AssistantConfig) -> AssistantStatus {
    let started = Instant::now();
    let mut status = AssistantStatus {
        ok: false,
        base_url: config.base_url.clone(),
        model: config.model.clone(),
        latency_ms: 0,
        models: Vec::new(),
        error: String::new(),
    };
    let config = match normalize_config(config.clone()) {
        Ok(c) => c,
        Err(e) => {
            status.base_url = config.base_url.clone();
            status.error = e;
            return status;
        }
    };
    status.base_url = config.base_url.clone();
    status.model = config.model.clone();
    let client = match client() {
        Ok(c) => c,
        Err(e) => {
            status.error = e;
            return status;
        }
    };
    let result = client.get(endpoint(&config.base_url, "models")).send();
    let result = match result {
        Ok(resp) if resp.status().is_success() => resp.json::<Value>(),
        Ok(resp) => Err(resp.error_for_status().unwrap_err()),
        Err(e) => Err(e),
    };
    match result {
        Ok(body) => {
            status.ok = true;
            status.models = model_names(&body);
        }
        Err(e) => status.error = format!("连接失败: {e}"),
    }
    status.latency_ms = started.elapsed().as_millis() as u64;
    status
}

/// 兼容 OpenAI (`data[].id`) 与 llama.cpp/Ollama (`models[].name` / `model`) 两种形状。
fn model_names(body: &Value) -> Vec<String> {
    let mut out = Vec::new();
    for key in ["data", "models"] {
        let Some(list) = body.get(key).and_then(Value::as_array) else {
            continue;
        };
        for item in list {
            for field in ["id", "name", "model"] {
                if let Some(name) = item.get(field).and_then(Value::as_str) {
                    if !name.is_empty() && !out.iter().any(|m| m == name) {
                        out.push(name.to_string());
                    }
                }
            }
        }
    }
    out
}

fn tool_specs() -> Value {
    json!([
        {
            "type": "function",
            "function": {
                "name": "workbench_context",
                "description": "工作台概况：项目数、未完成任务数、今日 AI 花费。回答总体问题先调这个。",
                "parameters": {"type": "object", "properties": {}, "required": []}
            }
        },
        {
            "type": "function",
            "function": {
                "name": "list_tasks",
                "description": "列出任务。可按状态过滤（todo/doing/done），默认只看未完成。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "status": {"type": "string", "enum": ["todo", "doing", "done"], "description": "任务状态"},
                        "limit": {"type": "integer", "description": "最多返回几条，默认 20，上限 50"}
                    },
                    "required": []
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "list_ports",
                "description": "列出本机监听端口与已识别的开发服务器（含框架与进程）。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "limit": {"type": "integer", "description": "最多返回几条，默认 20，上限 50"}
                    },
                    "required": []
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "cost_summary",
                "description": "AI 会话成本：今日/本月/累计花费与 token，按模型拆分前 5 名。",
                "parameters": {"type": "object", "properties": {}, "required": []}
            }
        },
        {
            "type": "function",
            "function": {
                "name": "search_knowledge",
                "description": "在本地 Markdown 知识库中检索，返回标题、路径与摘要。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "检索词"},
                        "limit": {"type": "integer", "description": "最多返回几条，默认 5，上限 10"}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "calculate",
                "description": "计算四则运算、折扣、百分比、括号。任何算术都必须先调用它，不要心算。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "expression": {"type": "string", "description": "只含数字、+ - * / 和括号，例如 (249*0.8)-15"}
                    },
                    "required": ["expression"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "current_date",
                "description": "返回这台机器的今天日期与星期。涉及今天、明天、周五、到期日时必须先调用它。",
                "parameters": {"type": "object", "properties": {}, "required": []}
            }
        },
        {
            "type": "function",
            "function": {
                "name": "create_task",
                "description": "创建一条任务。用户明确说“创建/新建/加/记一个任务”时必须调用本工具，不要用 list_tasks 代替，也不要只把标题复述成回答。只有用户在「知识库 → AI 接入」开启写入后才会成功。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "任务标题，只写要做的事；不要写“请帮我”“创建任务”，也不要把优先级/项目/截止日塞进标题。用户说中文时标题必须用中文，不要翻译成英文"},
                        "priority": {"type": "string", "enum": ["low", "normal", "high"]},
                        "due": {"type": "string", "description": "截止日 YYYY-MM-DD，可省略"},
                        "project_id": {"type": "string", "description": "所属项目 id，可省略"}
                    },
                    "required": ["title"]
                }
            }
        }
    ])
}

/// 本轮是否需要工具声明。
///
/// 8 个工具的 JSON Schema 在 2B 模型上约占 600–800 prompt token，纯聊天/写作
/// 却完全用不到。只在问题命中任务、端口、成本、知识库、算术或日期意图时才
/// 发送工具，让普通问答的首字延迟少一半左右。
fn needs_tools(text: &str) -> bool {
    const HINTS: &[&str] = &[
        "任务",
        "待办",
        "项目",
        "端口",
        "进程",
        "服务",
        "成本",
        "花费",
        "预算",
        "知识库",
        "笔记",
        "搜",
        "算",
        "折扣",
        "百分",
        "今天",
        "明天",
        "后天",
        "周",
        "日期",
        "截止",
        "逾期",
        "创建",
        "新建",
        "添加",
        "记一个",
        "提醒",
        "优先",
        "完成",
        "安排",
        "概况",
        "总览",
        "多少",
        "几号",
        "星期",
        "占用",
        "task",
        "todo",
        "project",
        "port",
        "process",
        "cost",
        "budget",
        "spend",
        "token",
        "model",
        "knowledge",
        "note",
        "search",
        "calculate",
        "today",
        "tomorrow",
        "date",
        "due",
        "create",
        "remind",
        "summary",
        "how much",
    ];
    let lower = text.to_lowercase();
    HINTS.iter().any(|hint| lower.contains(hint))
        || (lower.chars().any(|c| c.is_ascii_digit())
            && lower.chars().any(|c| "+-*/%×÷".contains(c)))
}

fn system_prompt(root: &DataRoot) -> String {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut facts = String::from("无法读取任务数据。");
    let mut cost = String::from("无法读取成本数据。");
    let mut project_names = String::from("无");
    if let Ok(data) = data::load_from_disk(root) {
        let open = data.tasks.iter().filter(|t| t.status != "done").count();
        let doing = data.tasks.iter().filter(|t| t.status == "doing").count();
        let overdue = data
            .tasks
            .iter()
            .filter(|t| {
                t.status != "done" && t.due.as_deref().is_some_and(|due| due < today.as_str())
            })
            .count();
        facts = format!(
            "{} 个项目、{} 条任务（{} 未完成，{} 进行中，{} 逾期）。",
            data.projects.len(),
            data.tasks.len(),
            open,
            doing,
            overdue
        );
        if !data.projects.is_empty() {
            project_names = data
                .projects
                .iter()
                .take(8)
                .map(|p| format!("{}({})", p.name, p.id))
                .collect::<Vec<_>>()
                .join("、");
        }
    }
    if let Ok(overview) = cost_store::build_overview(root) {
        cost = format!(
            "今日 ¥{:.2}，本月 ¥{:.2}，累计 ¥{:.2}。",
            overview.today_cost, overview.month_cost, overview.total_cost
        );
    }
    format!(
        "你是 Workbench 工作台的本地助手，模型 MiniCPM5-2B 运行在这台机器上。\n\
         今天是 {today}。\n\
         已知概况：{facts}{cost}项目：{project_names}。\n\
         规则：\n\
         1. 只依据工具返回的数据回答；没查到就直说没查到，不要编造任务、端口、花费或笔记。\n\
         2. 涉及具体任务、端口、成本明细、知识库内容时，先调用工具，再回答。\n\
         3. 用用户的语言回答，默认中文。先给结论，再给最多两条可执行建议，六句话以内。\n\
         4. 不要输出大段 Markdown；列清单时用短横线，每行一条。\n\
         5. 创建任务前必须确认标题来自用户原话；写入关闭时告诉用户去「知识库 → AI 接入」开启。\n\
         6. 任何算术（价格、折扣、百分比、差额）都必须调用 calculate，把结果照抄进回答，不要心算。\n\
         7. 涉及今天、明天、周五、几号、是否逾期时，必须先调用 current_date，不要凭记忆猜日期。
         8. 用户明确要求创建、新建、添加、记录一个任务时，必须调用 create_task；不要只复述任务，也不要用 list_tasks 代替创建。标题只写要做的事，保持用户原话的语言：用户说中文就写中文，不要把中文标题翻译成英文。截止日先用 current_date 换算成 YYYY-MM-DD。"
    )
}

/// 执行一轮对话（可能包含多轮工具调用）。阻塞调用，命令层负责 spawn_blocking。
pub fn chat(
    root: &DataRoot,
    config: &AssistantConfig,
    messages: Vec<ChatMessage>,
) -> Result<AssistantReply, String> {
    let cancel = AtomicBool::new(false);
    chat_stream(root, config, messages, &cancel, &mut |_| {})
}

/// 与 `chat` 相同，但把正文增量与工具步骤通过 `on_event` 推给调用方。
/// `cancel` 每个 SSE 分片检查一次；置位后最多再等当前一行。
pub fn chat_stream(
    root: &DataRoot,
    config: &AssistantConfig,
    messages: Vec<ChatMessage>,
    cancel: &AtomicBool,
    on_event: &mut dyn FnMut(AssistantEvent),
) -> Result<AssistantReply, String> {
    let config = normalize_config(config.clone())?;
    let history = normalize_history(messages)?;
    let last_user = history
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.clone())
        .unwrap_or_default();
    let client = client()?;
    let with_tools = needs_tools(&last_user);
    let mut payload_messages: Vec<Value> = vec![json!({
        "role": "system",
        "content": system_prompt(root),
    })];
    for message in &history {
        payload_messages.push(json!({
            "role": message.role,
            "content": message.content,
        }));
    }

    let mut steps: Vec<AssistantStep> = Vec::new();
    let mut usage = AssistantUsage::default();
    let mut tool_calls_total = 0usize;

    for _ in 0..=MAX_STEPS {
        if cancel.load(Ordering::Relaxed) {
            return Err(STOPPED.to_string());
        }
        let (content, calls) = stream_completion(
            &client,
            &config,
            &payload_messages,
            with_tools,
            cancel,
            &mut usage,
            on_event,
        )?;
        if calls.is_empty() {
            let content = if content.trim().is_empty() {
                final_summary(
                    &client,
                    &config,
                    &payload_messages,
                    &steps,
                    cancel,
                    &mut usage,
                    on_event,
                )?
            } else {
                content
            };
            if content.trim().is_empty() {
                return Err("模型没有返回内容".to_string());
            }
            let reply = AssistantReply {
                content,
                steps,
                usage,
                model: config.model,
            };
            on_event(AssistantEvent::done(reply.clone()));
            return Ok(reply);
        }
        if tool_calls_total + calls.len() > MAX_TOOL_CALLS {
            return Err(format!(
                "模型一次请求了过多工具（累计超过 {MAX_TOOL_CALLS} 个），已停止"
            ));
        }
        // 原样回填 assistant 的 tool_calls，服务端才能把结果和调用对上。
        payload_messages.push(json!({
            "role": "assistant",
            "content": if content.is_empty() { Value::Null } else { Value::String(content.clone()) },
            "tool_calls": calls.clone(),
        }));
        for call in &calls {
            if cancel.load(Ordering::Relaxed) {
                return Err(STOPPED.to_string());
            }
            tool_calls_total += 1;
            let (id, name, mut arguments) = parse_tool_call(call)?;
            if name == "create_task" {
                arguments = fill_create_task_fields(&arguments, &last_user);
            }
            let (result, ok) = match execute_tool(root, &name, &arguments) {
                Ok(text) => (truncate_chars(&text, MAX_TOOL_RESULT_CHARS), true),
                Err(e) => (
                    truncate_chars(&format!("错误: {e}"), MAX_TOOL_RESULT_CHARS),
                    false,
                ),
            };
            let step = AssistantStep {
                tool: name.clone(),
                arguments: arguments.clone(),
                result: result.clone(),
                ok,
            };
            steps.push(step.clone());
            on_event(AssistantEvent::step(step));
            payload_messages.push(json!({
                "role": "tool",
                "tool_call_id": id,
                "content": result,
            }));
        }
    }
    Err(format!(
        "模型连续调用工具超过 {MAX_STEPS} 轮，已停止。可以把问题拆小一点再问。"
    ))
}

/// 模型在拿到工具结果后偶尔会再调一次工具、正文为空。这里做一次
/// 「禁止工具」的收尾总结；仍失败就用工具原始结果兜底，绝不回空泡。
fn final_summary(
    client: &reqwest::blocking::Client,
    config: &AssistantConfig,
    payload: &[Value],
    steps: &[AssistantStep],
    cancel: &AtomicBool,
    usage: &mut AssistantUsage,
    on_event: &mut dyn FnMut(AssistantEvent),
) -> Result<String, String> {
    let mut messages = payload.to_vec();
    messages.push(json!({
        "role": "user",
        "content": "请根据上面的工具结果，用中文简洁回答我最初的问题。不要再调用工具，也不要再查数据。"
    }));
    if let Ok((content, _)) =
        stream_completion(client, config, &messages, false, cancel, usage, on_event)
    {
        if !content.trim().is_empty() {
            return Ok(content);
        }
    }
    if let Some(last) = steps.last() {
        return Ok(format!(
            "工具 {} 已返回结果，但模型没有生成总结。原始结果：\n{}",
            last.tool,
            truncate_chars(&last.result, 800)
        ));
    }
    Err("模型没有返回内容".to_string())
}

/// 一次模型调用。`stream=true` 时解析 SSE，把正文增量交给 `on_event`；
/// 服务端忽略 stream 返回整段 JSON 时走兼容分支。
fn stream_completion(
    client: &reqwest::blocking::Client,
    config: &AssistantConfig,
    messages: &[Value],
    with_tools: bool,
    cancel: &AtomicBool,
    usage: &mut AssistantUsage,
    on_event: &mut dyn FnMut(AssistantEvent),
) -> Result<(String, Vec<Value>), String> {
    let mut body = json!({
        "model": config.model.clone(),
        "messages": messages,
        "temperature": config.temperature,
        "max_tokens": config.max_tokens,
        "stream": true,
        "stream_options": { "include_usage": true },
        "chat_template_kwargs": { "enable_thinking": config.thinking },
    });
    if with_tools {
        body["tools"] = tool_specs();
        body["tool_choice"] = Value::String("auto".into());
    }
    let response = client
        .post(endpoint(&config.base_url, "chat/completions"))
        .json(&body)
        .send()
        .map_err(|e| format!("模型请求失败: {e}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().unwrap_or_default();
        return Err(format!(
            "模型返回 {status}: {}",
            text.chars().take(300).collect::<String>()
        ));
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !content_type.contains("text/event-stream") {
        // 有些服务忽略 stream:true，直接回一整段 JSON。
        let json: Value = response
            .json()
            .map_err(|e| format!("模型响应不是合法 JSON: {e}"))?;
        add_usage(usage, &json);
        let message = json
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .ok_or_else(|| "模型响应缺少 choices[0].message".to_string())?;
        let content = message_content(message);
        let calls = message
            .get("tool_calls")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if !content.trim().is_empty() {
            on_event(AssistantEvent::delta(content.clone()));
        }
        return Ok((content, calls));
    }

    let reader = BufReader::new(response);
    let mut content = String::new();
    let mut reasoning = String::new();
    let mut calls: BTreeMap<usize, ToolCallAcc> = BTreeMap::new();
    for line in reader.lines() {
        if cancel.load(Ordering::Relaxed) {
            return Err(STOPPED.to_string());
        }
        let line = line.map_err(|e| format!("读取模型流失败: {e}"))?;
        let Some(data) = line.trim_end().strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data == "[DONE]" {
            break;
        }
        let Ok(chunk) = serde_json::from_str::<Value>(data) else {
            continue;
        };
        add_usage(usage, &chunk);
        let Some(choice) = chunk.get("choices").and_then(|c| c.get(0)) else {
            continue;
        };
        let Some(delta) = choice.get("delta").or_else(|| choice.get("message")) else {
            continue;
        };
        if let Some(text) = delta.get("content").and_then(Value::as_str) {
            if !text.is_empty() {
                content.push_str(text);
                on_event(AssistantEvent::delta(text));
            }
        }
        if let Some(text) = delta.get("reasoning_content").and_then(Value::as_str) {
            reasoning.push_str(text);
        }
        if let Some(items) = delta.get("tool_calls").and_then(Value::as_array) {
            for item in items {
                merge_tool_delta(&mut calls, item);
            }
        }
    }
    if content.trim().is_empty() && !reasoning.trim().is_empty() {
        content = reasoning;
        on_event(AssistantEvent::delta(content.clone()));
    }
    let calls = calls
        .into_values()
        .filter_map(|call| {
            if call.name.is_empty() {
                None
            } else {
                Some(json!({
                    "id": if call.id.is_empty() { "call_unknown" } else { &call.id },
                    "type": "function",
                    "function": {"name": call.name, "arguments": call.arguments},
                }))
            }
        })
        .collect();
    Ok((content, calls))
}

#[derive(Default)]
struct ToolCallAcc {
    id: String,
    name: String,
    arguments: String,
}

fn merge_tool_delta(calls: &mut BTreeMap<usize, ToolCallAcc>, item: &Value) {
    let index = item.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
    let entry = calls.entry(index).or_default();
    if let Some(id) = item
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        entry.id = id.to_string();
    }
    let Some(function) = item.get("function") else {
        return;
    };
    if let Some(name) = function.get("name").and_then(Value::as_str) {
        entry.name = name.to_string();
    }
    match function.get("arguments") {
        Some(Value::String(fragment)) => entry.arguments.push_str(fragment),
        Some(value @ Value::Object(_)) => entry.arguments = value.to_string(),
        Some(Value::Null) | None => {}
        Some(other) => entry.arguments.push_str(&other.to_string()),
    }
}

fn message_content(message: &Value) -> String {
    let content = message
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if content.is_empty() {
        return message
            .get("reasoning_content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
    }
    content
}

fn add_usage(usage: &mut AssistantUsage, body: &Value) {
    let Some(u) = body.get("usage") else {
        return;
    };
    usage.prompt_tokens += u.get("prompt_tokens").and_then(Value::as_u64).unwrap_or(0);
    usage.completion_tokens += u
        .get("completion_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
}

fn normalize_history(messages: Vec<ChatMessage>) -> Result<Vec<ChatMessage>, String> {
    let mut out = Vec::new();
    for message in messages {
        let role = message.role.trim().to_ascii_lowercase();
        if role != "user" && role != "assistant" {
            return Err(format!("不支持的消息角色: {}", message.role));
        }
        let content = message.content.trim();
        if content.is_empty() {
            continue;
        }
        if content.chars().count() > MAX_MESSAGE_CHARS {
            return Err(format!("单条消息不能超过 {MAX_MESSAGE_CHARS} 字"));
        }
        out.push(ChatMessage {
            role,
            content: content.to_string(),
        });
    }
    // 先按条数、再按总字符预算保留最近的消息；最后一条用户消息必须留下，
    // 否则模型会答非所问。16 条 × 4000 字的上限对 8k 上下文毫无意义。
    let mut tail: Vec<ChatMessage> = Vec::new();
    let mut chars = 0usize;
    for message in out.into_iter().rev() {
        if tail.len() >= MAX_HISTORY {
            break;
        }
        let len = message.content.chars().count();
        if !tail.is_empty() && chars + len > MAX_HISTORY_CHARS {
            break;
        }
        chars += len;
        tail.push(message);
    }
    tail.reverse();
    let Some(last) = tail.last() else {
        return Err("请先输入内容".to_string());
    };
    if last.role != "user" {
        return Err("最后一条消息必须来自用户".to_string());
    }
    Ok(tail)
}

/// 解析 OpenAI 形状的工具调用；`arguments` 既可能是 JSON 字符串，也可能是对象。
fn parse_tool_call(call: &Value) -> Result<(String, String, String), String> {
    let id = call
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or("call_unknown")
        .to_string();
    let function = call
        .get("function")
        .ok_or_else(|| "工具调用缺少 function".to_string())?;
    let name = function
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| "工具调用缺少名称".to_string())?
        .to_string();
    let arguments = match function.get("arguments") {
        Some(Value::String(s)) => s.clone(),
        Some(value @ Value::Object(_)) => value.to_string(),
        Some(Value::Null) | None => "{}".to_string(),
        Some(other) => other.to_string(),
    };
    Ok((id, name, arguments))
}

fn execute_tool(root: &DataRoot, name: &str, raw_args: &str) -> Result<String, String> {
    let args: Value = if raw_args.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(raw_args).map_err(|e| format!("工具参数不是合法 JSON: {e}"))?
    };
    if !args.is_object() {
        return Err("工具参数必须是 JSON 对象".to_string());
    }
    match name {
        "workbench_context" => tool_context(root),
        "list_tasks" => tool_list_tasks(root, &args),
        "list_ports" => tool_list_ports(&args),
        "cost_summary" => tool_cost_summary(root),
        "search_knowledge" => tool_search_knowledge(root, &args),
        "calculate" => tool_calculate(&args),
        "current_date" => Ok(tool_current_date()),
        "create_task" => tool_create_task(root, &args),
        other => Err(format!("未知工具: {other}")),
    }
}

fn arg_usize(args: &Value, key: &str, default: usize, max: usize) -> usize {
    args.get(key)
        .and_then(Value::as_u64)
        .map(|n| n as usize)
        .unwrap_or(default)
        .clamp(1, max)
}

fn arg_str<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn tool_context(root: &DataRoot) -> Result<String, String> {
    let data = data::load_from_disk(root)?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let open = data
        .tasks
        .iter()
        .filter(|t| t.status != "done")
        .collect::<Vec<_>>();
    let overdue = open
        .iter()
        .filter(|t| t.due.as_deref().is_some_and(|d| d < today.as_str()))
        .count();
    let doing = open.iter().filter(|t| t.status == "doing").count();
    let cost = cost_store::build_overview(root).ok();
    Ok(json!({
        "projects": data.projects.len(),
        "tasks_total": data.tasks.len(),
        "tasks_open": open.len(),
        "tasks_doing": doing,
        "tasks_overdue": overdue,
        "today": today,
        "today_cost": cost.as_ref().map(|c| c.today_cost),
        "month_cost": cost.as_ref().map(|c| c.month_cost),
        "budget_exceeded": cost.as_ref().map(|c| c.budget_exceeded),
    })
    .to_string())
}

fn tool_list_tasks(root: &DataRoot, args: &Value) -> Result<String, String> {
    let data = data::load_from_disk(root)?;
    let status = arg_str(args, "status");
    let limit = arg_usize(args, "limit", 20, 50);
    let mut tasks: Vec<&data::Task> = data
        .tasks
        .iter()
        .filter(|t| match status {
            Some(status) => t.status == status,
            None => t.status != "done",
        })
        .collect();
    tasks.sort_by(|a, b| {
        let rank = |s: &str| match s {
            "doing" => 0,
            "todo" => 1,
            _ => 2,
        };
        rank(&a.status)
            .cmp(&rank(&b.status))
            .then_with(|| a.due.cmp(&b.due))
    });
    let rows: Vec<Value> = tasks
        .into_iter()
        .take(limit)
        .map(|t| {
            json!({
                "id": t.id,
                "title": t.title,
                "status": t.status,
                "priority": t.priority,
                "due": t.due,
                "project_id": t.project_id,
                "blocked_reason": t.blocked_reason,
                "next_step": t.next_step,
            })
        })
        .collect();
    Ok(json!({ "count": rows.len(), "tasks": rows }).to_string())
}

fn tool_list_ports(args: &Value) -> Result<String, String> {
    let limit = arg_usize(args, "limit", 20, 50);
    let snapshot = runtime::RuntimeSnapshot::capture()?;
    let servers: Vec<Value> = snapshot
        .dev_servers
        .iter()
        .take(limit)
        .map(|s| {
            json!({
                "port": s.port,
                "process": s.process_name,
                "framework": s.framework,
                "dir": s.project_dir,
            })
        })
        .collect();
    let listening: Vec<Value> = snapshot
        .ports
        .iter()
        .filter(|p| crate::ports::is_listening(&p.state) && p.local_port != 0)
        .take(limit)
        .map(|p| {
            json!({
                "protocol": p.protocol,
                "addr": p.local_addr,
                "port": p.local_port,
                "pid": p.pid,
            })
        })
        .collect();
    Ok(json!({ "dev_servers": servers, "listening": listening }).to_string())
}

fn tool_cost_summary(root: &DataRoot) -> Result<String, String> {
    let overview = cost_store::build_overview(root)?;
    let models = cost_store::build_model_breakdown(root).unwrap_or_default();
    let top: Vec<Value> = models
        .iter()
        .take(5)
        .map(|m| json!({ "model": m.model, "cost": m.cost, "tokens": m.input_tokens + m.output_tokens }))
        .collect();
    Ok(json!({
        "today_cost": overview.today_cost,
        "month_cost": overview.month_cost,
        "total_cost": overview.total_cost,
        "today_tokens": overview.today_input_tokens + overview.today_output_tokens,
        "records": overview.record_count,
        "estimated_records": overview.estimated_count,
        "daily_budget": overview.daily_budget,
        "budget_exceeded": overview.budget_exceeded,
        "top_models": top,
    })
    .to_string())
}

fn tool_search_knowledge(root: &DataRoot, args: &Value) -> Result<String, String> {
    let query = arg_str(args, "query").ok_or_else(|| "search_knowledge 需要 query".to_string())?;
    let limit = arg_usize(args, "limit", 5, 10);
    let hits = knowledge::search(root, query, Some(limit))?;
    let rows: Vec<Value> = hits
        .iter()
        .map(|h| {
            json!({
                "title": h.title,
                "path": h.path,
                "snippet": h.snippet,
            })
        })
        .collect();
    Ok(json!({ "query": query, "count": rows.len(), "hits": rows }).to_string())
}

/// 2B 常把整段指令塞进 `title`：去掉“请帮我/创建任务”等外壳，
/// 以及“，优先级高/属于项目 X”这类本该落在独立字段的尾注。
/// 这不是 JSON Schema 的替代，只是把最常见的脏输入挡在落库前。
fn normalize_task_title(raw: &str) -> Result<String, String> {
    let mut title = raw
        .trim()
        .trim_matches(['"', '“', '”', '\'', '「', '」'])
        .trim();
    for prefix in [
        "请帮我创建一个任务：",
        "请帮我创建任务：",
        "帮我创建一个任务：",
        "帮我创建任务：",
        "请帮我建一个任务：",
        "帮我建一个任务：",
        "创建一个任务：",
        "创建任务：",
        "新建一个任务：",
        "新建任务：",
        "添加一个任务：",
        "记录一个任务：",
        "记一个任务：",
        "建一个任务：",
        "任务：",
        "请帮我",
        "帮我",
        "麻烦",
    ] {
        if let Some(rest) = title.strip_prefix(prefix) {
            title = rest.trim();
            break;
        }
    }
    let meta = [
        "优先级",
        "属于项目",
        "项目 id",
        "项目id",
        "截止",
        "到期",
        "due",
        "priority",
    ];
    for sep in ['，', ',', '；', ';'] {
        if let Some((head, tail)) = title.split_once(sep) {
            let lower = tail.to_ascii_lowercase();
            if !head.trim().is_empty() && meta.iter().any(|m| lower.contains(m)) {
                title = head.trim();
                break;
            }
        }
    }
    let title = strip_leading_relative_date(title);
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if title.is_empty() {
        return Err("create_task 的 title 不能为空".to_string());
    }
    if title.chars().count() > 120 {
        return Err("create_task 的 title 太长（上限 120 字符）".to_string());
    }
    Ok(title)
}

fn has_cjk(text: &str) -> bool {
    text.chars()
        .any(|c| matches!(c as u32, 0x3400..=0x4DBF | 0x4E00..=0x9FFF))
}

/// 标题里的“明天/周五”已经落到 `due`，不再留在标题里重复。
fn strip_leading_relative_date(title: &str) -> &str {
    for prefix in [
        "大后天",
        "后天",
        "明天",
        "今天",
        "周一",
        "周二",
        "周三",
        "周四",
        "周五",
        "周六",
        "周日",
        "星期一",
        "星期二",
        "星期三",
        "星期四",
        "星期五",
        "星期六",
        "星期日",
        "星期天",
    ] {
        if let Some(rest) = title.strip_prefix(prefix) {
            return rest.trim_start_matches([',', '，', '、', ' ', ':', '：']);
        }
    }
    title
}

/// 从用户原话里抽一个中文标题，作为模型把中文翻成英文时的确定性兜底。
/// 只做“去外壳、去尾注、去句首日期”，不改写语义。
fn task_title_from_user(text: &str) -> Option<String> {
    normalize_task_title(text).ok()
}

/// 模型已给中文标题就保留；用户是中文、模型却只给了 ASCII 标题时，
/// 用原话里的中文标题覆盖，避免任务列表出现语言漂移。
fn fill_create_task_fields(raw_args: &str, user_text: &str) -> String {
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(raw_args) else {
        return raw_args.to_string();
    };
    let mut changed = false;
    let today = chrono::Local::now().date_naive();
    if value.get("due").is_none_or(|v| v.is_null()) {
        if let Some(due) = infer_due_from_text(user_text, today) {
            value["due"] = serde_json::Value::String(due);
            changed = true;
        }
    }
    let model_title = value
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    if has_cjk(user_text) && !has_cjk(model_title) {
        if let Some(title) = task_title_from_user(user_text) {
            value["title"] = serde_json::Value::String(title);
            changed = true;
        }
    }
    if changed {
        serde_json::to_string(&value).unwrap_or_else(|_| raw_args.to_string())
    } else {
        raw_args.to_string()
    }
}

fn tool_create_task(root: &DataRoot, args: &Value) -> Result<String, String> {
    if !ai_service::allow_writes(root)? {
        return Err("写入未开启：请用户在「知识库 → AI 接入」打开写入开关".to_string());
    }
    let title = normalize_task_title(
        arg_str(args, "title").ok_or_else(|| "create_task 需要 title".to_string())?,
    )?;
    let due = arg_str(args, "due").map(normalize_due).transpose()?;
    let action = ai_service::task_create(
        root,
        TaskCreateArgs {
            title: title.to_string(),
            status: Some("todo".to_string()),
            priority: arg_str(args, "priority").map(str::to_string),
            due,
            project_id: arg_str(args, "project_id").map(str::to_string),
            tags: Vec::new(),
            next_step: None,
            blocked_reason: None,
        },
    )?;
    Ok(json!({
        "created": true,
        "id": action.target,
        "summary": action.summary,
        "undo": format!("ai_undo({})", action.id),
    })
    .to_string())
}

/// 四则运算工具。只允许数字、小数点、+ - * /、括号和空格；
/// 手写递归下降，不引入 eval 类逻辑。
fn tool_calculate(args: &Value) -> Result<String, String> {
    let expression =
        arg_str(args, "expression").ok_or_else(|| "calculate 需要 expression".to_string())?;
    if expression.chars().count() > 200 {
        return Err("表达式太长（上限 200 字符）".to_string());
    }
    let value = CalcParser::new(expression).parse()?;
    if !value.is_finite() {
        return Err("计算结果不是有限数字".to_string());
    }
    let text = if (value - value.round()).abs() < 1e-9 {
        format!("{}", value.round() as i64)
    } else {
        let mut s = format!("{value:.6}");
        while s.ends_with('0') {
            s.pop();
        }
        if s.ends_with('.') {
            s.pop();
        }
        s
    };
    Ok(json!({"expression": expression, "result": value, "text": text}).to_string())
}

fn tool_current_date() -> String {
    use chrono::Datelike;
    let now = chrono::Local::now();
    let weekday_cn = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
        [now.weekday().num_days_from_sunday() as usize];
    json!({
        "date": now.format("%Y-%m-%d").to_string(),
        "weekday": now.format("%A").to_string(),
        "weekday_cn": weekday_cn,
        "time": now.format("%H:%M").to_string(),
    })
    .to_string()
}

struct CalcParser<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> CalcParser<'a> {
    fn new(input: &'a str) -> Self {
        Self {
            bytes: input.as_bytes(),
            pos: 0,
        }
    }
    fn parse(mut self) -> Result<f64, String> {
        if self.bytes.iter().any(|b| {
            !matches!(
                *b,
                b'0'..=b'9' | b'.' | b'+' | b'-' | b'*' | b'/' | b'(' | b')' | b' '
            )
        }) {
            return Err("表达式只能包含数字、+ - * / 和括号".to_string());
        }
        let value = self.expr()?;
        self.ws();
        if self.pos != self.bytes.len() {
            return Err("表达式末尾有多余字符".to_string());
        }
        Ok(value)
    }
    fn ws(&mut self) {
        while self.pos < self.bytes.len() && self.bytes[self.pos].is_ascii_whitespace() {
            self.pos += 1;
        }
    }
    fn peek(&mut self) -> Option<u8> {
        self.ws();
        self.bytes.get(self.pos).copied()
    }
    fn expr(&mut self) -> Result<f64, String> {
        let mut value = self.term()?;
        loop {
            match self.peek() {
                Some(b'+') => {
                    self.pos += 1;
                    value += self.term()?;
                }
                Some(b'-') => {
                    self.pos += 1;
                    value -= self.term()?;
                }
                _ => return Ok(value),
            }
        }
    }
    fn term(&mut self) -> Result<f64, String> {
        let mut value = self.unary()?;
        loop {
            match self.peek() {
                Some(b'*') => {
                    self.pos += 1;
                    value *= self.unary()?;
                }
                Some(b'/') => {
                    self.pos += 1;
                    let divisor = self.unary()?;
                    if divisor == 0.0 {
                        return Err("不能除以 0".to_string());
                    }
                    value /= divisor;
                }
                _ => return Ok(value),
            }
        }
    }
    fn unary(&mut self) -> Result<f64, String> {
        match self.peek() {
            Some(b'+') => {
                self.pos += 1;
                self.unary()
            }
            Some(b'-') => {
                self.pos += 1;
                Ok(-self.unary()?)
            }
            Some(b'(') => {
                self.pos += 1;
                let value = self.expr()?;
                if self.peek() != Some(b')') {
                    return Err("括号没有闭合".to_string());
                }
                self.pos += 1;
                Ok(value)
            }
            _ => self.number(),
        }
    }
    fn number(&mut self) -> Result<f64, String> {
        self.ws();
        let start = self.pos;
        let mut dot = false;
        while let Some(b) = self.bytes.get(self.pos) {
            if b.is_ascii_digit() {
                self.pos += 1;
            } else if *b == b'.' && !dot {
                dot = true;
                self.pos += 1;
            } else {
                break;
            }
        }
        if start == self.pos || self.bytes[start] == b'.' {
            return Err("表达式缺少数值".to_string());
        }
        let text = &self.bytes[start..self.pos];
        std::str::from_utf8(text)
            .ok()
            .and_then(|s| s.parse::<f64>().ok())
            .ok_or_else(|| "数字格式不正确".to_string())
    }
}

fn normalize_due(raw: &str) -> Result<String, String> {
    chrono::NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d")
        .map(|d| d.format("%Y-%m-%d").to_string())
        .map_err(|_| format!("due 必须是 YYYY-MM-DD，收到: {raw}"))
}

/// 2B 经常调用 `current_date` 却忘记把日期塞进 `create_task` 的 `due`。
/// 用户说“今天/明天/后天/周X”时，由后端按同一台机器的本地日期补上，
/// 避免任务落库后丢掉截止日；模型已给 due 则一律不改。
fn infer_due_from_text(text: &str, today: chrono::NaiveDate) -> Option<String> {
    use chrono::Datelike;
    let text = text.to_lowercase();
    if text.contains("大后天") {
        return Some(
            (today + chrono::Duration::days(3))
                .format("%Y-%m-%d")
                .to_string(),
        );
    }
    if text.contains("后天") {
        return Some(
            (today + chrono::Duration::days(2))
                .format("%Y-%m-%d")
                .to_string(),
        );
    }
    if text.contains("明天") || text.contains("tomorrow") {
        return Some(
            (today + chrono::Duration::days(1))
                .format("%Y-%m-%d")
                .to_string(),
        );
    }
    if text.contains("今天") || text.contains("today") {
        return Some(today.format("%Y-%m-%d").to_string());
    }
    // “下周”可能指下一整周，不在这里猜；只处理“周五/星期五”这种最近一次。
    if text.contains("下周") || text.contains("上周") {
        return None;
    }
    let weekdays: [(i64, &[&str]); 7] = [
        (0, &["周一", "星期一"]),
        (1, &["周二", "星期二"]),
        (2, &["周三", "星期三"]),
        (3, &["周四", "星期四"]),
        (4, &["周五", "星期五"]),
        (5, &["周六", "星期六"]),
        (6, &["周日", "周天", "星期日", "星期天"]),
    ];
    for (idx, names) in weekdays {
        if names.iter().any(|n| text.contains(n)) {
            let current = today.weekday().num_days_from_monday() as i64;
            let mut ahead = (idx - current).rem_euclid(7);
            if ahead == 0 {
                ahead = 7; // “周五”在周五当天说，按下一个周五算
            }
            return Some(
                (today + chrono::Duration::days(ahead))
                    .format("%Y-%m-%d")
                    .to_string(),
            );
        }
    }
    None
}

/// 按字符截断，保证中文不会被切成半个 UTF-8 序列。
pub fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQ: AtomicU64 = AtomicU64::new(0);

    fn temp_root(tag: &str) -> DataRoot {
        let path = std::env::temp_dir().join(format!(
            "wb-assistant-{tag}-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).expect("创建测试目录失败");
        DataRoot::new(&path)
    }

    fn seed_tasks(root: &DataRoot) {
        let data = data::WorkbenchData {
            schema_version: Some(data::SCHEMA_VERSION),
            projects: vec![data::Project {
                id: "p1".into(),
                name: "工作台".into(),
                path: "/tmp".into(),
                status: "active".into(),
                tags: Vec::new(),
                pinned: false,
                note: String::new(),
                goal: None,
                created_at: 1,
            }],
            tasks: vec![
                data::Task {
                    id: "t1".into(),
                    title: "写测试".into(),
                    status: "doing".into(),
                    priority: "high".into(),
                    due: Some("2026-01-01".into()),
                    project_id: Some("p1".into()),
                    tags: Vec::new(),
                    next_step: None,
                    blocked_reason: None,
                    completed_at: None,
                    created_at: 1,
                    updated_at: 1,
                },
                data::Task {
                    id: "t2".into(),
                    title: "已完成的".into(),
                    status: "done".into(),
                    priority: "normal".into(),
                    due: None,
                    project_id: None,
                    tags: Vec::new(),
                    next_step: None,
                    blocked_reason: None,
                    completed_at: Some(2),
                    created_at: 1,
                    updated_at: 2,
                },
            ],
        };
        data::save_to_disk(root, &data).expect("写入测试数据失败");
    }

    #[test]
    fn rejects_remote_endpoints() {
        let err = normalize_base_url("http://example.com/v1").unwrap_err();
        assert!(err.contains("只允许连接本机"), "{err}");
        let err = normalize_base_url("http://127.0.0.1.evil.com/v1").unwrap_err();
        assert!(err.contains("只允许连接本机"), "{err}");
        let err = normalize_base_url("ftp://127.0.0.1/v1").unwrap_err();
        assert!(err.contains("http"), "{err}");
    }

    #[test]
    fn accepts_loopback_and_strips_trailing_slash() {
        assert_eq!(
            normalize_base_url("http://127.0.0.1:18082/v1/").unwrap(),
            "http://127.0.0.1:18082/v1"
        );
        assert_eq!(
            normalize_base_url(" https://localhost:8443/v1 ").unwrap(),
            "https://localhost:8443/v1"
        );
        assert_eq!(
            normalize_base_url("http://[::1]:11434/v1").unwrap(),
            "http://[::1]:11434/v1"
        );
    }

    #[test]
    fn rejects_credentials_and_query() {
        assert!(normalize_base_url("http://user:pass@127.0.0.1/v1").is_err());
        assert!(normalize_base_url("http://127.0.0.1/v1?key=1").is_err());
    }

    #[test]
    fn config_bounds_are_enforced() {
        let cfg = AssistantConfig {
            temperature: 3.0,
            ..Default::default()
        };
        assert!(normalize_config(cfg).is_err());
        let cfg = AssistantConfig {
            max_tokens: 10,
            ..Default::default()
        };
        assert!(normalize_config(cfg).is_err());
        let cfg = AssistantConfig {
            model: "  ".into(),
            ..Default::default()
        };
        assert!(normalize_config(cfg).is_err());
    }

    #[test]
    fn parses_tool_call_with_string_and_object_arguments() {
        let call = json!({
            "id": "c1",
            "type": "function",
            "function": {"name": "list_tasks", "arguments": "{\"status\":\"doing\"}"}
        });
        let (id, name, args) = parse_tool_call(&call).unwrap();
        assert_eq!(id, "c1");
        assert_eq!(name, "list_tasks");
        assert_eq!(args, "{\"status\":\"doing\"}");

        let call = json!({
            "id": "c2",
            "function": {"name": "list_tasks", "arguments": {"status": "todo"}}
        });
        let (_, _, args) = parse_tool_call(&call).unwrap();
        assert!(args.contains("todo"));
    }

    #[test]
    fn list_tasks_defaults_to_open_tasks() {
        let root = temp_root("tasks");
        seed_tasks(&root);
        let out = tool_list_tasks(&root, &json!({})).unwrap();
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["count"], 1);
        assert_eq!(parsed["tasks"][0]["id"], "t1");

        let out = tool_list_tasks(&root, &json!({"status": "done"})).unwrap();
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["count"], 1);
        assert_eq!(parsed["tasks"][0]["id"], "t2");
    }

    #[test]
    fn create_task_requires_write_switch() {
        let root = temp_root("write");
        let err = execute_tool(&root, "create_task", r#"{"title":"x"}"#).unwrap_err();
        assert!(err.contains("写入未开启"), "{err}");
    }

    #[test]
    fn unknown_tool_is_reported() {
        let root = temp_root("unknown");
        let err = execute_tool(&root, "not_a_tool", "{}").unwrap_err();
        assert!(err.contains("未知工具"), "{err}");
    }

    #[test]
    fn truncate_is_utf8_safe() {
        assert_eq!(truncate_chars("中文截断测试", 2), "中文…");
        assert_eq!(truncate_chars("abc", 3), "abc");
    }

    /// 需要本机 18082 端口跑着 MiniCPM5-2B；CI 不跑（`--ignored` 手动执行）。
    /// 这是唯一验证「模型真的会调工具、工具结果真的回到模型」的测试。
    #[test]
    #[ignore = "需要本机 18082 上的 MiniCPM5-2B 服务"]
    fn live_chat_uses_tools_end_to_end() {
        let root = temp_root("live");
        seed_tasks(&root);
        let reply = chat(
            &root,
            &AssistantConfig::default(),
            vec![ChatMessage {
                role: "user".into(),
                content: "我现在有哪些任务？".into(),
            }],
        )
        .expect("本机模型应可用");
        assert!(
            reply.steps.iter().any(|s| s.tool == "list_tasks"),
            "模型没有调用 list_tasks: {:?}",
            reply.steps
        );
        assert!(
            reply.content.contains("写测试") || reply.content.contains("1"),
            "回答没有用上工具结果: {}",
            reply.content
        );
    }

    #[test]
    fn status_reports_unreachable_service_without_panicking() {
        let cfg = AssistantConfig {
            base_url: "http://127.0.0.1:1/v1".into(),
            ..AssistantConfig::default()
        };
        let status = status(&cfg);
        assert!(!status.ok);
        assert!(!status.error.is_empty());
    }

    #[test]
    fn calculator_handles_precedence_and_decimals() {
        let root = temp_root("calc");
        let raw = execute_tool(&root, "calculate", r#"{"expression":"(249*0.8)-15"}"#).unwrap();
        let value: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(value["result"], 184.2);
        assert_eq!(value["text"], "184.2");

        let raw = execute_tool(&root, "calculate", r#"{"expression":"2+3*4"}"#).unwrap();
        let value: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(value["result"], 14.0);
        assert!(execute_tool(&root, "calculate", r#"{"expression":"1/0"}"#).is_err());
        assert!(execute_tool(&root, "calculate", r#"{"expression":"1+($)"}"#).is_err());
    }

    #[test]
    fn relative_due_is_filled_without_overwriting_model_value() {
        use chrono::NaiveDate;
        let base = NaiveDate::from_ymd_opt(2026, 11, 21).unwrap(); // 周六
        assert_eq!(infer_due_from_text("明天检查", base).unwrap(), "2026-11-22");
        assert_eq!(infer_due_from_text("后天检查", base).unwrap(), "2026-11-23");
        assert_eq!(infer_due_from_text("今天检查", base).unwrap(), "2026-11-21");
        assert_eq!(infer_due_from_text("周五检查", base).unwrap(), "2026-11-27");
        assert_eq!(infer_due_from_text("下周一检查", base), None);

        let today = chrono::Local::now().date_naive();
        let args = fill_create_task_fields(r#"{"title":"x"}"#, "明天检查登录页");
        let value: serde_json::Value = serde_json::from_str(&args).unwrap();
        assert_eq!(
            value["due"].as_str().unwrap(),
            (today + chrono::Duration::days(1))
                .format("%Y-%m-%d")
                .to_string()
        );
        let explicit = r#"{"title":"x","due":"2026-12-01"}"#;
        let value: serde_json::Value =
            serde_json::from_str(&fill_create_task_fields(explicit, "明天检查")).unwrap();
        assert_eq!(value["due"].as_str().unwrap(), "2026-12-01");
    }

    #[test]
    fn chinese_title_is_restored_when_model_translates_to_english() {
        let user = "帮我创建任务：明天检查登录页报错，优先级高";
        let args = fill_create_task_fields(r#"{"title":"Check login page error"}"#, user);
        let value: serde_json::Value = serde_json::from_str(&args).unwrap();
        assert_eq!(value["title"].as_str().unwrap(), "检查登录页报错");
        assert_eq!(
            value["due"].as_str().unwrap(),
            (chrono::Local::now().date_naive() + chrono::Duration::days(1))
                .format("%Y-%m-%d")
                .to_string()
        );

        // 模型已经给出中文标题时不覆盖。
        let args = fill_create_task_fields(r#"{"title":"修复登录页"}"#, user);
        let value: serde_json::Value = serde_json::from_str(&args).unwrap();
        assert_eq!(value["title"].as_str().unwrap(), "修复登录页");

        // 用户用英文时不做中文兜底。
        let args = fill_create_task_fields(
            r#"{"title":"Check login page"}"#,
            "Please create a task: check login page tomorrow",
        );
        assert!(args.contains("Check login page"));
        assert_eq!(task_title_from_user(user).unwrap(), "检查登录页报错");
    }

    #[test]
    fn task_title_strips_instruction_and_metadata() {
        assert_eq!(
            normalize_task_title("请帮我创建任务：修复登录页报错，优先级高，属于项目 p-login")
                .unwrap(),
            "修复登录页报错"
        );
        assert_eq!(normalize_task_title("  写周报  ").unwrap(), "写周报");
        assert_eq!(
            normalize_task_title("明天检查登录页报错").unwrap(),
            "检查登录页报错"
        );
        assert!(normalize_task_title("   ").is_err());
        assert!(normalize_task_title(&"长".repeat(121)).is_err());
    }

    #[test]
    fn create_task_rejects_malformed_due_date() {
        assert!(normalize_due("2026-11-21").is_ok());
        assert!(normalize_due("2026-13-01").is_err());
        assert!(normalize_due("明天").is_err());
    }

    /// 需要本机 18082 模型；验证 SSE 解析、增量拼装与 done 事件一致。
    #[test]
    #[ignore = "需要本机 18082 上的 MiniCPM5-2B 服务"]
    fn live_stream_emits_deltas_and_done() {
        let root = temp_root("stream");
        seed_tasks(&root);
        let mut events: Vec<AssistantEvent> = Vec::new();
        let cancel = AtomicBool::new(false);
        let reply = chat_stream(
            &root,
            &AssistantConfig::default(),
            vec![ChatMessage {
                role: "user".into(),
                content: "用一句话介绍你自己。".into(),
            }],
            &cancel,
            &mut |event| events.push(event),
        )
        .unwrap();
        let deltas: String = events
            .iter()
            .filter(|e| e.kind == "delta")
            .map(|e| e.text.as_str())
            .collect();
        assert!(!deltas.is_empty(), "没有收到任何 delta");
        assert_eq!(deltas.trim(), reply.content.trim());
        assert!(events.iter().any(|e| e.kind == "done"));
    }

    /// 真实拉起/停止一次 llama-server；需要环境变量提供二进制与 GGUF，默认跳过。
    #[test]
    #[ignore]
    fn service_lifecycle_real_binary() {
        let (Ok(bin), Ok(model)) = (
            std::env::var("WORKBENCH_TEST_LLAMA_BIN"),
            std::env::var("WORKBENCH_TEST_GGUF"),
        ) else {
            eprintln!("skip: WORKBENCH_TEST_LLAMA_BIN/WORKBENCH_TEST_GGUF 未设置");
            return;
        };
        let root = temp_root("service-live");
        let cfg = AssistantConfig {
            base_url: "http://127.0.0.1:18084/v1".into(),
            model: "minicpm5-2b".into(),
            context_size: 4096,
            server_bin: bin,
            model_path: model,
            ..AssistantConfig::default()
        };
        let started = start_service(&root, cfg.clone()).expect("服务应能启动");
        assert!(started.ok);
        assert!(root.join("assistant-service.log").is_file());
        assert!(stop_service().unwrap(), "应停掉应用内启动的子进程");
        let after = status(&cfg);
        assert!(!after.ok);
    }

    #[test]
    fn start_service_requires_binary_and_model_paths() {
        let root = temp_root("service");
        assert!(start_service(&root, AssistantConfig::default()).is_err());
        let cfg = AssistantConfig {
            base_url: "http://127.0.0.1:18099/v1".into(),
            server_bin: "/nonexistent/llama-server".into(),
            model_path: "/nonexistent/model.gguf".into(),
            ..AssistantConfig::default()
        };
        assert!(start_service(&root, cfg).is_err());
        assert!(!stop_service().unwrap());
    }

    #[test]
    fn tool_declarations_are_skipped_for_plain_chat() {
        assert!(!needs_tools("写一段海边日落描写，直接写正文。"));
        assert!(!needs_tools("你好，介绍一下你自己"));
        assert!(needs_tools("今天最该先处理什么？"));
        assert!(needs_tools("本月 AI 花费多少？"));
        assert!(needs_tools("249*0.8 等于多少"));
        assert!(needs_tools("帮我创建一个任务：明天检查登录页"));
    }

    #[test]
    fn history_is_trimmed_by_char_budget() {
        let mut messages = Vec::new();
        for i in 0..21 {
            messages.push(ChatMessage {
                role: if i % 2 == 0 {
                    "user".into()
                } else {
                    "assistant".into()
                },
                content: "字".repeat(300),
            });
        }
        let trimmed = normalize_history(messages).unwrap();
        let total: usize = trimmed.iter().map(|m| m.content.chars().count()).sum();
        assert!(total <= MAX_HISTORY_CHARS);
        assert!(trimmed.len() < 21);
        assert_eq!(trimmed.last().unwrap().role, "user");
    }
}
