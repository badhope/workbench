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
/// 单次 HTTP 请求上限：2B 在 CPU 上生成 1k token 可能要几十秒。
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

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

impl Default for AssistantConfig {
    fn default() -> Self {
        Self {
            base_url: default_base_url(),
            model: default_model(),
            temperature: default_temperature(),
            max_tokens: default_max_tokens(),
            thinking: false,
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
                "name": "create_task",
                "description": "创建一条任务。只有用户在「知识库 → AI 接入」开启写入后才会成功。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "任务标题，必须具体"},
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
         5. 创建任务前必须确认标题来自用户原话；写入关闭时告诉用户去「知识库 → AI 接入」开启。"
    )
}

/// 执行一轮对话（可能包含多轮工具调用）。阻塞调用，命令层负责 spawn_blocking。
pub fn chat(
    root: &DataRoot,
    config: &AssistantConfig,
    messages: Vec<ChatMessage>,
) -> Result<AssistantReply, String> {
    let config = normalize_config(config.clone())?;
    let history = normalize_history(messages)?;
    let client = client()?;
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
        let body = json!({
            "model": config.model.clone(),
            "messages": payload_messages.clone(),
            "tools": tool_specs(),
            "tool_choice": "auto",
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
            "stream": false,
            // llama.cpp / Ollama 的 OpenAI 兼容端点支持这个开关；不支持的
            // 服务会忽略它。MiniCPM5 系模板默认会先思考，这里显式关掉，
            // 否则 2B 模型在 CPU 上会把 token 全花在思考里。
            "chat_template_kwargs": { "enable_thinking": config.thinking },
        });
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
        let json: Value = response
            .json()
            .map_err(|e| format!("模型响应不是合法 JSON: {e}"))?;
        add_usage(&mut usage, &json);
        let message = json
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .ok_or_else(|| "模型响应缺少 choices[0].message".to_string())?;
        let mut content = message
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        if content.is_empty() {
            // 有些模板把正文写进 reasoning_content；宁可展示它，也不要回一个空泡。
            content = message
                .get("reasoning_content")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string();
        }
        let calls = message
            .get("tool_calls")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if calls.is_empty() {
            if content.is_empty() {
                return Err("模型没有返回内容".to_string());
            }
            return Ok(AssistantReply {
                content,
                steps,
                usage,
                model: config.model,
            });
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
            tool_calls_total += 1;
            let (id, name, arguments) = parse_tool_call(call)?;
            let (result, ok) = match execute_tool(root, &name, &arguments) {
                Ok(text) => (truncate_chars(&text, MAX_TOOL_RESULT_CHARS), true),
                Err(e) => (
                    truncate_chars(&format!("错误: {e}"), MAX_TOOL_RESULT_CHARS),
                    false,
                ),
            };
            steps.push(AssistantStep {
                tool: name.clone(),
                arguments: arguments.clone(),
                result: result.clone(),
                ok,
            });
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
    let tail: Vec<ChatMessage> = out.split_off(out.len().saturating_sub(MAX_HISTORY));
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

fn tool_create_task(root: &DataRoot, args: &Value) -> Result<String, String> {
    if !ai_service::allow_writes(root)? {
        return Err("写入未开启：请用户在「知识库 → AI 接入」打开写入开关".to_string());
    }
    let title = arg_str(args, "title").ok_or_else(|| "create_task 需要 title".to_string())?;
    let action = ai_service::task_create(
        root,
        TaskCreateArgs {
            title: title.to_string(),
            status: Some("todo".to_string()),
            priority: arg_str(args, "priority").map(str::to_string),
            due: arg_str(args, "due").map(str::to_string),
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
        let mut cfg = AssistantConfig::default();
        cfg.temperature = 3.0;
        assert!(normalize_config(cfg).is_err());
        let mut cfg = AssistantConfig::default();
        cfg.max_tokens = 10;
        assert!(normalize_config(cfg).is_err());
        let mut cfg = AssistantConfig::default();
        cfg.model = "  ".into();
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
}
