//! AI 会话感知：识别本机 AI 编码代理进程、拉取 opencode 在线会话、扫描本地会话记录文件。
//! 新增：获取 opencode 会话详情、解析 .jsonl 会话预览。

use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

/// AI 代理关键词（小写匹配 name / cmdline / exe 路径）。
pub const AI_AGENT_KEYWORDS: &[&str] = &[
    "opencode",
    "claude",
    "codex",
    "cursor",
    "windsurf",
    "aider",
    "copilot",
    "gemini",
    "qwen",
    "iflow",
    "crush",
    "openhands",
    "goose",
    "continue",
    "cline",
    "roo",
    "kilo",
    "amp",
    "zed",
];

/// 把字符串按非字母数字切成 token（词边界），避免 "amp" 误命中 "sample" 这类子串。
fn ascii_tokens(hay: &str) -> impl Iterator<Item = &str> {
    hay.split(|c: char| !c.is_ascii_alphanumeric())
}

/// 返回命中的 AI 关键词（token 精确匹配 name / cmdline / exe 三段）。
pub fn find_ai_keyword(name_lower: &str, cmd_lower: &str, exe_lower: &str) -> Option<&'static str> {
    AI_AGENT_KEYWORDS.iter().copied().find(|kw| {
        [name_lower, cmd_lower, exe_lower]
            .iter()
            .any(|hay| ascii_tokens(hay).any(|t| t == *kw))
    })
}

#[derive(Serialize, Clone, Debug, ts_rs::TS)]
pub struct AiProcess {
    pub pid: u32,
    pub name: String,
    pub exe_path: String,
    pub cmd_line: String,
    pub matched: String,
    #[ts(type = "number")]
    pub memory: u64,
    #[ts(type = "number")]
    pub start_time: u64,
}

#[derive(Serialize, Clone, Debug, ts_rs::TS)]
pub struct OpencodeSession {
    pub id: String,
    pub title: String,
    #[ts(type = "number")]
    pub created: i64,
    #[ts(type = "number")]
    pub updated: i64,
}

/// opencode 会话详情（消息摘要）。
#[derive(Serialize, Clone, Debug, ts_rs::TS)]
pub struct SessionDetail {
    pub id: String,
    pub title: String,
    pub message_count: usize,
    pub first_message: String,
    pub last_message: String,
    #[ts(type = "number")]
    pub duration_seconds: i64,
    pub tools_used: Vec<String>,
    pub error: String,
}

/// opencode 会话 id 只允许这些字符：id 会被拼进 URL 路径段，
/// 放行 `/`、`?`、`#`、`%` 就等于让前端能改写请求路径与查询串。
fn is_safe_session_id(raw: &str) -> bool {
    !raw.is_empty()
        && raw.len() <= 128
        && raw
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':'))
}

/// 路径段 percent-encode。校验通过后再编码属于双保险。
fn encode_path_segment(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for byte in raw.as_bytes() {
        let c = *byte as char;
        if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~') {
            out.push(c);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// 统一构造失败详情，避免每个错误分支重复一遍结构体。
fn detail_error(id: &str, title: &str, error: String) -> SessionDetail {
    SessionDetail {
        id: id.to_string(),
        title: title.to_string(),
        message_count: 0,
        first_message: String::new(),
        last_message: String::new(),
        duration_seconds: 0,
        tools_used: Vec::new(),
        error,
    }
}

/// 从本地 opencode server 拉会话列表（GET /session）。
pub fn fetch_opencode_sessions(port: u16) -> Result<Vec<OpencodeSession>, String> {
    let url = format!("http://127.0.0.1:{port}/session");
    let resp = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(1500))
        // 本机服务的 3xx 会把请求带到任意外网地址：跟随重定向等于开放出站口子
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("客户端创建失败: {e}"))?
        .get(&url)
        .send()
        .map_err(|e| format!("请求失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    let body: serde_json::Value = resp.json().map_err(|e| format!("响应解析失败: {e}"))?;
    let arr = match body.as_array() {
        Some(a) => a,
        None => return Err("响应不是会话数组".to_string()),
    };
    let mut sessions = Vec::new();
    for item in arr {
        let id = item
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let title = item
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("(未命名会话)")
            .to_string();
        let (created, updated) = match item.get("time") {
            Some(t) => (
                t.get("created")
                    .and_then(|v| v.as_i64())
                    .unwrap_or_default(),
                t.get("updated")
                    .and_then(|v| v.as_i64())
                    .unwrap_or_default(),
            ),
            None => (0, 0),
        };
        // id 之后会被前端原样传回拼进详情 URL，这里就按同一规则过滤
        if !id.is_empty() && is_safe_session_id(&id) {
            sessions.push(OpencodeSession {
                id,
                title,
                created,
                updated,
            });
        }
    }
    Ok(sessions)
}

/// 拉取单个 opencode 会话详情（GET /session/{id}）。
pub fn fetch_session_detail(port: u16, session_id: &str) -> SessionDetail {
    if !is_safe_session_id(session_id) {
        log::warn!("拒绝非法会话 id（长度 {}）", session_id.len());
        return detail_error(
            session_id,
            "(非法会话 id)",
            "会话 id 含不允许的字符".to_string(),
        );
    }
    if !(1..=65535).contains(&port) {
        return detail_error(session_id, "(非法端口)", "端口不在允许范围".to_string());
    }

    let url = format!(
        "http://127.0.0.1:{port}/session/{}",
        encode_path_segment(session_id)
    );
    let resp = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(2000))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .and_then(|c| c.get(&url).send());

    let resp = match resp {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            return detail_error(
                session_id,
                "(获取失败)",
                format!("HTTP {}", r.status().as_u16()),
            )
        }
        Err(e) => return detail_error(session_id, "(获取失败)", e.to_string()),
    };

    let body: serde_json::Value = match resp.json() {
        Ok(v) => v,
        Err(e) => return detail_error(session_id, "(解析失败)", e.to_string()),
    };

    // 解析消息列表
    let messages = body
        .get("messages")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let message_count = messages.len();

    let extract_text = |v: &serde_json::Value| -> String {
        v.get("content")
            .and_then(|c| {
                if c.is_string() {
                    c.as_str().map(|s| s.to_string())
                } else if c.is_array() {
                    // 多部分内容：提取所有 text 类型
                    c.as_array().map(|parts| {
                        parts
                            .iter()
                            .filter_map(|p| {
                                if p.get("type").and_then(|t| t.as_str()) == Some("text") {
                                    p.get("text")
                                        .and_then(|t| t.as_str())
                                        .map(|s| s.to_string())
                                } else {
                                    None
                                }
                            })
                            .collect::<Vec<_>>()
                            .join(" ")
                    })
                } else {
                    None
                }
            })
            .unwrap_or_default()
    };

    let first_message = messages.first().map(extract_text).unwrap_or_default();
    let last_message = messages.last().map(extract_text).unwrap_or_default();

    // 提取使用的工具（不去重：前端按次数做分布统计）
    let tools_used: Vec<String> = messages
        .iter()
        .filter_map(|m| {
            m.get("content").and_then(|c| c.as_array()).map(|parts| {
                parts
                    .iter()
                    .filter_map(|p| {
                        if p.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                            p.get("name")
                                .and_then(|n| n.as_str())
                                .map(|s| s.to_string())
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<_>>()
            })
        })
        .flatten()
        .collect();

    // 持续时间（从消息时间戳推算）
    let get_ts = |v: &serde_json::Value| -> Option<i64> {
        v.get("time")
            .or_else(|| v.get("timestamp"))
            .and_then(|t| t.as_i64())
    };
    let duration_seconds = match (
        messages.first().and_then(get_ts),
        messages.last().and_then(get_ts),
    ) {
        (Some(start), Some(end)) => (end - start) / 1000,
        _ => 0,
    };

    let title = body
        .get("title")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "(未命名会话)".to_string());

    SessionDetail {
        id: session_id.to_string(),
        title,
        message_count,
        first_message: first_message.chars().take(200).collect(),
        last_message: last_message.chars().take(200).collect(),
        duration_seconds,
        tools_used,
        error: String::new(),
    }
}

#[derive(Serialize, Clone, Debug, ts_rs::TS)]
pub struct SessionFile {
    pub tool: String,
    pub project: String,
    pub path: String,
    #[ts(type = "number")]
    pub modified: u64,
    #[ts(type = "number")]
    pub size: u64,
}

/// 本地文件增强预览：消息条数、首条内容、最近一条内容。
#[derive(Serialize, Clone, Debug, ts_rs::TS)]
pub struct SessionFilePreview {
    pub tool: String,
    pub project: String,
    pub path: String,
    #[ts(type = "number")]
    pub modified: u64,
    #[ts(type = "number")]
    pub size: u64,
    pub message_count: usize,
    pub first_line: String,
    pub last_line: String,
    pub human_preview: String,
}

/// 扫描 ~/.claude/projects 与 ~/.codex/sessions 下的全部会话记录（*.jsonl），按修改时间倒序。
/// 目录不存在时返回空。成本计量必须用全量，不能只看最近几条。
pub fn collect_all_session_files(home: &Path) -> Result<Vec<SessionFile>, &'static str> {
    collect_session_files_with_budget(home, ScanBudget::default())
}

/// UI 预览只取最近 N 条（成本计量走 collect_all_session_files 全量，不受此限制）。
pub const PREVIEW_LIMIT: usize = 10;

/// 最近 N 条（UI 预览用）。
pub fn scan_session_files(home: &Path) -> Result<Vec<SessionFile>, &'static str> {
    let mut files = collect_all_session_files(home)?;
    files.truncate(PREVIEW_LIMIT);
    Ok(files)
}

/// 增强扫描：包含消息条数和内容预览。
pub fn scan_session_files_with_preview(
    home: &Path,
) -> Result<Vec<SessionFilePreview>, &'static str> {
    let basic = scan_session_files(home)?;
    basic
        .into_iter()
        .map(|f| {
            let (message_count, first_line, last_line) = parse_jsonl_preview(&f.path)?;
            let human_preview = if message_count == 0 {
                "(空文件)"
            } else {
                if !last_line.is_empty() {
                    &last_line
                } else {
                    &first_line
                }
            };
            Ok(SessionFilePreview {
                tool: f.tool,
                project: f.project,
                path: f.path,
                modified: f.modified,
                size: f.size,
                message_count,
                first_line: first_line.chars().take(200).collect(),
                last_line: last_line.chars().take(200).collect(),
                human_preview: human_preview.chars().take(200).collect(),
            })
        })
        .collect()
}

fn parse_jsonl_preview(path: &str) -> Result<(usize, String, String), &'static str> {
    let file = open_session_file(Path::new(path))?;
    let before = file.metadata().map_err(|_| "session file metadata error")?;
    let mut reader = SessionReader::new(file);
    let mut count = 0;
    let mut first = String::new();
    let mut last = String::new();
    while let Some(line) = reader.next_line()? {
        if line.trim().is_empty() {
            continue;
        }
        count += 1;
        if first.is_empty() {
            first = line.clone();
        }
        last = line;
    }
    // 从 JSON 提取可读文本（Claude Code 格式）
    let extract_text = |s: &str| -> String {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(s) {
            // Claude Code session 格式
            if let Some(msg) = v.get("message").cloned().filter(|m| !m.is_null()) {
                if let Some(content) = msg.get("content") {
                    return extract_content_text(content);
                }
            }
            // 顶层 type + content
            if let Some(t) = v.get("type").and_then(|t| t.as_str()) {
                if t == "summary" {
                    return v
                        .get("summary")
                        .and_then(|s| s.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_default();
                }
            }
            // 直接 Content 数组
            if let Some(content) = v.get("content") {
                return extract_content_text(content);
            }
        }
        // 前 100 字符兜底
        s.chars().take(100).collect()
    };
    check_session_unchanged(&before, reader.file())?;
    let first_text = extract_text(&first);
    let last_text = extract_text(&last);
    Ok((count, first_text, last_text))
}

pub(crate) fn open_session_file(path: &Path) -> Result<fs::File, &'static str> {
    let meta = fs::symlink_metadata(path).map_err(|_| "session file metadata error")?;
    if !is_plain_metadata(&meta) || !meta.is_file() {
        return Err("session file is not a regular file");
    }
    let file = fs::File::open(path).map_err(|_| "session file open error")?;
    let opened = file.metadata().map_err(|_| "session file metadata error")?;
    if !is_plain_metadata(&opened) || !opened.is_file() {
        return Err("session file is not a regular file");
    }
    // 检查路径与真正打开的文件是不是同一个对象：中间被替换成别的文件
    // （含指向别处的链接）时，类型检查仍会通过，只有身份能识别出来。
    // 注意这仍不是句柄级遍历：父目录在打开前被整体替换成链接时，
    // 路径解析依旧会跟随；彻底解决需要逐级相对句柄打开。
    if !same_file_identity(&meta, &opened) {
        return Err("session file changed during open");
    }
    Ok(file)
}

/// 比较两次 metadata 是否指向同一个文件对象。
#[cfg(unix)]
fn same_file_identity(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    a.dev() == b.dev() && a.ino() == b.ino()
}

#[cfg(windows)]
fn same_file_identity(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    // std 的 volume_serial_number/file_index 仍是 unstable（windows_by_handle），
    // 稳定 API 里没有真正的文件 ID。这里用「创建时间 + 长度 + 写时间」做较弱
    // 身份：替换成另一个文件几乎必然改变创建时间，能拦住常见的换文件/换链接，
    // 但不如 Unix 的 dev+ino 严格（原地同尺寸改写且保留时间戳仍可能漏过）。
    a.creation_time() == b.creation_time()
        && a.file_size() == b.file_size()
        && a.last_write_time() == b.last_write_time()
        && a.file_attributes() == b.file_attributes()
}

pub(crate) fn check_session_unchanged(
    before: &fs::Metadata,
    file: &fs::File,
) -> Result<(), &'static str> {
    let after = file.metadata().map_err(|_| "session file metadata error")?;
    let before_modified = before
        .modified()
        .map_err(|_| "session file metadata error")?;
    let after_modified = after
        .modified()
        .map_err(|_| "session file metadata error")?;
    if before.len() != after.len() || before_modified != after_modified {
        return Err("session file changed during read");
    }
    Ok(())
}

struct BudgetedSessionFile<'a> {
    file: fs::File,
    budget: Option<&'a mut crate::session_meter::ScanReadBudget>,
    position: u64,
}

impl std::io::Read for BudgetedSessionFile<'_> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        use std::io::Error;
        if buf.is_empty() {
            return Ok(0);
        }
        let limit = match self.budget.as_ref() {
            Some(budget) if budget.remaining == 0 => {
                if self.file.metadata()?.len() > self.position {
                    return Err(Error::other("session scan read budget exceeded"));
                }
                return Ok(0);
            }
            Some(budget) => buf
                .len()
                .min(budget.remaining.min(usize::MAX as u64) as usize),
            None => buf.len(),
        };
        let count = self.file.read(&mut buf[..limit])?;
        self.position += count as u64;
        if let Some(budget) = self.budget.as_mut() {
            budget.remaining -= count as u64;
        }
        Ok(count)
    }
}

pub(crate) struct SessionReader<'a> {
    reader: std::io::BufReader<std::io::Take<BudgetedSessionFile<'a>>>,
    bytes: usize,
    lines: usize,
}

impl<'a> SessionReader<'a> {
    pub(crate) fn new(file: fs::File) -> Self {
        Self::with_optional_budget(file, None)
    }

    pub(crate) fn with_budget(
        file: fs::File,
        budget: &'a mut crate::session_meter::ScanReadBudget,
    ) -> Self {
        Self::with_optional_budget(file, Some(budget))
    }

    fn with_optional_budget(
        file: fs::File,
        budget: Option<&'a mut crate::session_meter::ScanReadBudget>,
    ) -> Self {
        use std::io::Read;
        Self {
            reader: std::io::BufReader::new(
                BudgetedSessionFile {
                    file,
                    budget,
                    position: 0,
                }
                .take(32 * 1024 * 1024 + 1),
            ),
            bytes: 0,
            lines: 0,
        }
    }

    pub(crate) fn file(&self) -> &fs::File {
        &self.reader.get_ref().get_ref().file
    }

    pub(crate) fn next_line(&mut self) -> Result<Option<String>, &'static str> {
        use std::io::BufRead;
        const FILE_LIMIT: usize = 32 * 1024 * 1024;
        const LINE_LIMIT: usize = 128 * 1024;
        const LINE_COUNT_LIMIT: usize = 100_000;
        let mut line = Vec::new();
        loop {
            let available = self
                .reader
                .fill_buf()
                .map_err(|_| "session file read error")?;
            if available.is_empty() {
                if line.is_empty() {
                    return Ok(None);
                }
                break;
            }
            if self.lines == LINE_COUNT_LIMIT {
                return Err("session file line count limit exceeded");
            }
            let n = available
                .iter()
                .position(|&b| b == b'\n')
                .map_or(available.len(), |n| n + 1);
            let newline = available[n - 1] == b'\n';
            let content_len = n - usize::from(newline);
            if self.bytes + n > FILE_LIMIT {
                return Err("session file size limit exceeded");
            }
            let total_len = line.len() + content_len;
            let last = available[..content_len].last().or_else(|| line.last());
            if total_len > LINE_LIMIT && !(total_len == LINE_LIMIT + 1 && last == Some(&b'\r')) {
                return Err("session file line size limit exceeded");
            }
            line.extend_from_slice(&available[..content_len]);
            self.reader.consume(n);
            self.bytes += n;
            if newline {
                break;
            }
        }
        self.lines += 1;
        if line.last() == Some(&b'\r') {
            line.pop();
        }
        String::from_utf8(line)
            .map(Some)
            .map_err(|_| "session file invalid UTF-8")
    }
}

fn extract_content_text(content: &serde_json::Value) -> String {
    if content.is_string() {
        content.as_str().unwrap_or("").chars().take(200).collect()
    } else if let Some(arr) = content.as_array() {
        arr.iter()
            .filter_map(|p| {
                if p.get("type").and_then(|t| t.as_str()) == Some("text") {
                    p.get("text")
                        .and_then(|t| t.as_str())
                        .map(|s| s.to_string())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(200)
            .collect()
    } else {
        String::new()
    }
}

fn is_plain_metadata(meta: &fs::Metadata) -> bool {
    if meta.file_type().is_symlink() {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return false;
        }
    }
    true
}

#[derive(Clone, Copy)]
pub struct ScanBudget {
    pub depth: usize,
    pub entries: usize,
    pub files: usize,
}

impl Default for ScanBudget {
    fn default() -> Self {
        Self {
            depth: 64,
            entries: 100_000,
            files: 10_000,
        }
    }
}

pub fn collect_session_files_with_budget(
    home: &Path,
    budget: ScanBudget,
) -> Result<Vec<SessionFile>, &'static str> {
    fn directory(path: &Path, optional: bool) -> Result<bool, &'static str> {
        let meta = match fs::symlink_metadata(path) {
            Ok(meta) => meta,
            Err(err) if optional && err.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(_) => return Err("session scan metadata error"),
        };
        if !is_plain_metadata(&meta) {
            return Err("session scan skipped a link");
        }
        if !meta.is_dir() {
            return Err("session scan expected a directory");
        }
        Ok(true)
    }

    fn walk(
        dir: &Path,
        tool: &str,
        depth: usize,
        budget: ScanBudget,
        entries_seen: &mut usize,
        files: &mut Vec<SessionFile>,
    ) -> Result<(), &'static str> {
        for entry in fs::read_dir(dir).map_err(|_| "session scan directory read error")? {
            let entry = entry.map_err(|_| "session scan directory entry error")?;
            if *entries_seen >= budget.entries {
                return Err("session scan entry limit exceeded");
            }
            *entries_seen += 1;
            let path = entry.path();
            let meta = fs::symlink_metadata(&path).map_err(|_| "session scan metadata error")?;
            let is_jsonl = path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("jsonl"));
            if !is_plain_metadata(&meta) {
                if !is_jsonl && fs::metadata(&path).is_ok_and(|target| target.is_file()) {
                    continue;
                }
                return Err("session scan skipped a link");
            }
            if meta.is_dir() {
                if depth >= budget.depth {
                    return Err("session scan depth limit exceeded");
                }
                walk(&path, tool, depth + 1, budget, entries_seen, files)?;
            } else if meta.is_file() && is_jsonl {
                if files.len() >= budget.files {
                    return Err("session scan file limit exceeded");
                }
                let modified = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or_default();
                let project = path
                    .parent()
                    .and_then(|p| p.file_name())
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                files.push(SessionFile {
                    tool: tool.to_string(),
                    project,
                    path: path.to_string_lossy().to_string(),
                    modified,
                    size: meta.len(),
                });
            } else if is_jsonl {
                return Err("session file is not a regular file");
            }
        }
        Ok(())
    }

    directory(home, false)?;
    let mut files = Vec::new();
    let mut entries_seen = 0;
    for (tool, parent, child) in [
        ("Claude Code", ".claude", "projects"),
        ("Codex CLI", ".codex", "sessions"),
    ] {
        let parent = home.join(parent);
        if directory(&parent, true)? {
            let root = parent.join(child);
            if directory(&root, true)? {
                walk(&root, tool, 0, budget, &mut entries_seen, &mut files)?;
            }
        }
    }
    files.sort_by_key(|f| std::cmp::Reverse(f.modified));
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct ScanFixture(PathBuf);

    impl ScanFixture {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("target")
                .join(format!(
                    "scan-fixture-{}-{}",
                    std::process::id(),
                    NEXT.fetch_add(1, Ordering::Relaxed)
                ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for ScanFixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn session_reader_line_terminator_boundaries() {
        let fixture = ScanFixture::new();
        let path = fixture.0.join("lines.jsonl");
        let content = "x".repeat(128 * 1024);
        for prefix in ["".to_owned(), format!("{}\n", "p".repeat(8190))] {
            for terminator in ["\n", "\r\n", "", "\r"] {
                let suffix = if terminator.ends_with('\n') {
                    "next\n"
                } else {
                    ""
                };
                fs::write(&path, format!("{prefix}{content}{terminator}{suffix}")).unwrap();
                let mut reader = SessionReader::new(fs::File::open(&path).unwrap());
                if !prefix.is_empty() {
                    assert_eq!(reader.next_line().unwrap(), Some("p".repeat(8190)));
                }
                assert_eq!(reader.next_line().unwrap(), Some(content.clone()));
                if !suffix.is_empty() {
                    assert_eq!(reader.next_line().unwrap(), Some("next".to_owned()));
                }
                assert_eq!(reader.next_line().unwrap(), None);
            }
            for ending in ["x\n", "x\r\n", "x", "\rx\n"] {
                fs::write(&path, format!("{prefix}{content}{ending}")).unwrap();
                let mut reader = SessionReader::new(fs::File::open(&path).unwrap());
                if !prefix.is_empty() {
                    reader.next_line().unwrap();
                }
                assert_eq!(
                    reader.next_line().unwrap_err(),
                    "session file line size limit exceeded"
                );
            }
        }
    }

    #[test]
    fn read_budget_rejects_oversized_lines_and_invalid_utf8() {
        let fixture = ScanFixture::new();
        let root = fixture.0.join(".claude").join("projects");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("session.jsonl");
        for bytes in [vec![b'x'; 128 * 1024 + 1], vec![0xff]] {
            fs::write(&path, bytes).unwrap();
            assert!(scan_session_files_with_preview(&fixture.0).is_err());
            let entry = crate::session_meter::SessionFileEntry {
                path: path.to_string_lossy().into_owned(),
                tool: String::new(),
                project: String::new(),
                modified: 0,
                size: 0,
            };
            assert!(crate::session_meter::scan_complete_sessions(
                &[entry],
                &crate::pricing::PricingTable::default()
            )
            .is_err());
        }
    }

    #[test]
    fn read_budget_boundaries_and_error_privacy() {
        let fixture = ScanFixture::new();
        let root = fixture.0.join(".claude").join("projects");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("session.jsonl");
        let entry = crate::session_meter::SessionFileEntry {
            path: path.to_string_lossy().into_owned(),
            tool: String::new(),
            project: String::new(),
            modified: 0,
            size: 0,
        };
        let verify = |valid: bool| {
            let preview = scan_session_files_with_preview(&fixture.0);
            let billing = crate::session_meter::scan_complete_sessions(
                std::slice::from_ref(&entry),
                &crate::pricing::PricingTable::default(),
            );
            assert_eq!(preview.is_ok(), valid);
            assert_eq!(billing.is_ok(), valid);
            if let Err(err) = billing {
                assert!(!err.contains(&entry.path));
            }
        };
        fs::write(&path, format!("\"{}\"", "é".repeat((128 * 1024 - 2) / 2))).unwrap();
        verify(true);
        fs::write(&path, format!("\"{}x\"", "é".repeat((128 * 1024 - 2) / 2))).unwrap();
        verify(false);
        fs::write(&path, "{}\n".repeat(100_000)).unwrap();
        verify(true);
        fs::write(&path, "{}\n".repeat(100_001)).unwrap();
        verify(false);
        let line = format!("\"{}\"\n", "x".repeat(128 * 1024 - 3));
        let exact = line.repeat(256);
        assert_eq!(exact.len(), 32 * 1024 * 1024);
        fs::write(&path, &exact).unwrap();
        verify(true);
        fs::write(&path, format!("{exact}\n")).unwrap();
        verify(false);
        fs::write(&path, b"{invalid}\n").unwrap();
        let err = crate::session_meter::scan_complete_sessions(
            std::slice::from_ref(&entry),
            &crate::pricing::PricingTable::default(),
        )
        .unwrap_err();
        assert!(!err.contains(&entry.path));
    }

    #[test]
    fn read_budget_rejects_non_file_and_missing_file() {
        let fixture = ScanFixture::new();
        for path in [fixture.0.clone(), fixture.0.join("missing.jsonl")] {
            assert!(parse_jsonl_preview(path.to_str().unwrap()).is_err());
            let entry = crate::session_meter::SessionFileEntry {
                path: path.to_string_lossy().into_owned(),
                tool: String::new(),
                project: String::new(),
                modified: 0,
                size: 0,
            };
            let err = crate::session_meter::scan_complete_sessions(
                std::slice::from_ref(&entry),
                &crate::pricing::PricingTable::default(),
            )
            .unwrap_err();
            assert!(!err.contains(&entry.path));
        }
    }

    #[test]
    fn budget_scan_reports_limits_and_missing_roots() {
        let fixture = ScanFixture::new();
        let root = fixture.0.join(".claude").join("projects");
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(root.join("a.jsonl"), b"{}\n").unwrap();
        fs::write(root.join("nested").join("b.jsonl"), b"{}\n").unwrap();
        let budget = ScanBudget {
            depth: 4,
            entries: 10,
            files: 2,
        };
        assert_eq!(
            collect_session_files_with_budget(&fixture.0, budget)
                .unwrap()
                .len(),
            2
        );
        assert!(
            collect_session_files_with_budget(&fixture.0, ScanBudget { files: 1, ..budget })
                .is_err()
        );
        assert!(collect_session_files_with_budget(
            &fixture.0,
            ScanBudget {
                entries: 1,
                ..budget
            }
        )
        .is_err());
        assert!(
            collect_session_files_with_budget(&fixture.0, ScanBudget { depth: 0, ..budget })
                .is_err()
        );
        assert!(collect_session_files_with_budget(&fixture.0.join("absent"), budget).is_err());
        let empty = fixture.0.join("empty");
        fs::create_dir(&empty).unwrap();
        assert!(collect_session_files_with_budget(&empty, budget)
            .unwrap()
            .is_empty());
        fs::write(empty.join(".claude"), b"not a directory").unwrap();
        let error = collect_session_files_with_budget(&empty, budget).unwrap_err();
        assert_eq!(error, "session scan expected a directory");
        assert!(!error.contains(&fixture.0.to_string_lossy().to_string()));
        let defaults = ScanBudget::default();
        assert_eq!(
            (defaults.depth, defaults.files, defaults.entries),
            (64, 10_000, 100_000)
        );
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn budget_scan_skips_unrelated_file_link() {
        let fixture = ScanFixture::new();
        let root = fixture.0.join(".claude").join("projects");
        fs::create_dir_all(&root).unwrap();
        let target = fixture.0.join("outside.txt");
        fs::write(&target, b"unrelated").unwrap();
        fs::write(root.join("session.jsonl"), b"{}\n").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&target, root.join("notes.txt")).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(&target, root.join("notes.txt")).unwrap();
        let files = collect_all_session_files(&fixture.0).unwrap();
        assert_eq!(files.len(), 1);
        assert!(files[0].path.ends_with("session.jsonl"));
    }

    #[test]
    fn budget_scan_exact_boundaries_span_both_roots() {
        let fixture = ScanFixture::new();
        let claude = fixture.0.join(".claude").join("projects");
        let codex = fixture.0.join(".codex").join("sessions");
        fs::create_dir_all(claude.join("nested")).unwrap();
        fs::create_dir_all(&codex).unwrap();
        fs::write(claude.join("nested").join("a.jsonl"), b"{}\n").unwrap();
        fs::write(codex.join("b.jsonl"), b"{}\n").unwrap();
        let budget = ScanBudget {
            depth: 1,
            entries: 3,
            files: 2,
        };
        let files = collect_session_files_with_budget(&fixture.0, budget).unwrap();
        assert_eq!(files.len(), 2);
        assert!(files.iter().any(|f| f.tool == "Claude Code"));
        assert!(files.iter().any(|f| f.tool == "Codex CLI"));
        assert_eq!(
            collect_session_files_with_budget(&fixture.0, ScanBudget { depth: 0, ..budget })
                .unwrap_err(),
            "session scan depth limit exceeded"
        );
        assert_eq!(
            collect_session_files_with_budget(
                &fixture.0,
                ScanBudget {
                    entries: 2,
                    ..budget
                }
            )
            .unwrap_err(),
            "session scan entry limit exceeded"
        );
        assert_eq!(
            collect_session_files_with_budget(&fixture.0, ScanBudget { files: 1, ..budget })
                .unwrap_err(),
            "session scan file limit exceeded"
        );
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn budget_scan_reports_potential_target_links() {
        let fixture = ScanFixture::new();
        let root = fixture.0.join(".claude").join("projects");
        fs::create_dir_all(&root).unwrap();
        let target = fixture.0.join("outside.txt");
        fs::write(&target, b"{}\n").unwrap();
        let link = root.join("session.JSONL");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&target, &link).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(&target, &link).unwrap();
        assert_eq!(
            collect_all_session_files(&fixture.0).unwrap_err(),
            "session scan skipped a link"
        );
        fs::remove_file(&link).unwrap();
        let dangling = root.join("unknown.txt");
        #[cfg(unix)]
        std::os::unix::fs::symlink(fixture.0.join("missing"), &dangling).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(fixture.0.join("missing"), &dangling).unwrap();
        assert_eq!(
            collect_all_session_files(&fixture.0).unwrap_err(),
            "session scan skipped a link"
        );
    }

    #[cfg(windows)]
    #[test]
    fn budget_scan_reports_links_without_paths() {
        let fixture = ScanFixture::new();
        let root = fixture.0.join(".claude").join("projects");
        let outside = fixture.0.join("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        junction(&root.join("linked"), &outside);
        let error = collect_session_files_with_budget(
            &fixture.0,
            ScanBudget {
                depth: 4,
                entries: 10,
                files: 10,
            },
        )
        .unwrap_err();
        assert!(!error.contains(&fixture.0.to_string_lossy().to_string()));
        fs::remove_dir(root.join("linked")).unwrap();
    }

    #[test]
    fn scan_accepts_ascii_case_insensitive_jsonl_files() {
        let fixture = ScanFixture::new();
        let root = fixture.0.join(".claude").join("projects").join("project");
        fs::create_dir_all(&root).unwrap();
        for name in ["one.jsonl", "two.JSONL", "three.JsOnL", "ignored.json"] {
            fs::write(root.join(name), b"{}\n").unwrap();
        }
        let files = collect_all_session_files(&fixture.0).unwrap();
        assert_eq!(files.len(), 3);
        assert!(files.iter().any(|file| file.path.ends_with("two.JSONL")));
        assert!(files.iter().any(|file| file.path.ends_with("three.JsOnL")));
    }

    #[cfg(windows)]
    fn junction(link: &Path, target: &Path) {
        let status = std::process::Command::new("cmd.exe")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .status()
            .unwrap();
        assert!(status.success(), "could not create junction fixture");
    }

    #[cfg(windows)]
    #[test]
    fn scan_rejects_root_parent_and_child_junctions() {
        let fixture = ScanFixture::new();
        let outside = fixture.0.join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("outside.jsonl"), b"{}\n").unwrap();
        let home = fixture.0.join("home");
        let valid = home.join(".codex").join("sessions").join("valid.jsonl");
        fs::create_dir_all(valid.parent().unwrap()).unwrap();
        fs::write(&valid, b"{}\n").unwrap();
        let assert_incomplete = || {
            assert_eq!(
                collect_all_session_files(&home).unwrap_err(),
                "session scan skipped a link"
            );
        };
        junction(&home.join(".claude"), &outside);
        fs::create_dir_all(outside.join("projects")).unwrap();
        fs::write(outside.join("projects").join("parent.jsonl"), b"{}\n").unwrap();
        assert_incomplete();
        fs::remove_dir(home.join(".claude")).unwrap();
        fs::create_dir_all(home.join(".claude")).unwrap();
        junction(&home.join(".claude").join("projects"), &outside);
        assert_incomplete();
        fs::remove_dir(home.join(".claude").join("projects")).unwrap();
        let root = home.join(".claude").join("projects");
        fs::create_dir_all(&root).unwrap();
        junction(&root.join("linked"), &outside);
        assert_incomplete();
        fs::remove_dir(root.join("linked")).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn scan_rejects_junction_home() {
        let fixture = ScanFixture::new();
        let real_home = fixture.0.join("real-home");
        let root = real_home.join(".claude").join("projects");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("valid.jsonl"), b"{}\n").unwrap();
        assert_eq!(collect_all_session_files(&real_home).unwrap().len(), 1);
        let linked_home = fixture.0.join("linked-home");
        junction(&linked_home, &real_home);
        assert!(collect_all_session_files(&linked_home).is_err());
        fs::remove_dir(linked_home).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn scan_rejects_directory_symlink() {
        use std::os::unix::fs::symlink;
        let fixture = ScanFixture::new();
        let root = fixture.0.join(".claude").join("projects");
        let outside = fixture.0.join("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("external.jsonl"), b"{}\n").unwrap();
        symlink(&outside, root.join("linked-dir")).unwrap();
        assert!(collect_all_session_files(&fixture.0).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn scan_skips_fifo_without_opening_it() {
        let fixture = ScanFixture::new();
        let root = fixture.0.join(".claude").join("projects");
        fs::create_dir_all(&root).unwrap();
        assert!(std::process::Command::new("mkfifo")
            .arg(root.join("pipe.jsonl"))
            .status()
            .unwrap()
            .success());
        assert!(collect_all_session_files(&fixture.0).unwrap().is_empty());
    }

    #[test]
    fn detects_agents_and_ignores_normal_apps() {
        assert_eq!(find_ai_keyword("claude.exe", "claude", ""), Some("claude"));
        assert_eq!(
            find_ai_keyword(
                "node.exe",
                "node c:\\users\\me\\appdata\\roaming\\npm\\node_modules\\opencode\\bin\\opencode",
                ""
            ),
            Some("opencode")
        );
        assert_eq!(
            find_ai_keyword("chrome.exe", "chrome --type=renderer", ""),
            None
        );
        assert_eq!(find_ai_keyword("code.exe", "code", ""), None);
    }

    #[test]
    fn token_boundary_avoids_substring_false_positives() {
        // "amp" / "roo" / "zed" 不应被子串（sample / classroom / lazy）命中
        assert_eq!(
            find_ai_keyword("sample.exe", "sample --run", "c:\\ramp\\bin"),
            None
        );
        assert_eq!(
            find_ai_keyword("classroom.exe", "open classroom app", ""),
            None
        );
        // 真正的词边界命中
        assert_eq!(find_ai_keyword("amp.exe", "amp", ""), Some("amp"));
        assert_eq!(
            find_ai_keyword("node.exe", "npx claude-code run", ""),
            Some("claude")
        );
    }

    #[test]
    fn session_id_gate_blocks_url_path_injection() {
        assert!(is_safe_session_id("ses_abc123"));
        assert!(is_safe_session_id("ses:123-45"));
        // 路径穿越 / 查询串注入 / 空 id / 超长
        assert!(!is_safe_session_id("../../../etc/passwd"));
        assert!(!is_safe_session_id("abc?port=9"));
        assert!(!is_safe_session_id("abc#frag"));
        assert!(!is_safe_session_id("abc%2fdef"));
        assert!(!is_safe_session_id(""));
        assert!(!is_safe_session_id(&"s".repeat(129)));
    }

    #[test]
    fn path_segment_encoding_keeps_unreserved_only() {
        assert_eq!(encode_path_segment("ses_abc-123.X~"), "ses_abc-123.X~");
        assert_eq!(encode_path_segment("a b"), "a%20b");
        assert_eq!(encode_path_segment("a/b?c"), "a%2Fb%3Fc");
    }

    #[test]
    fn illegal_session_id_never_reaches_the_network() {
        // 端口 1 上没有服务：合法 id 会走请求并返回连接错误，非法 id 必须在发请求前被拒
        let blocked = fetch_session_detail(1, "../../windows/system32");
        assert_eq!(blocked.title, "(非法会话 id)");
        assert!(blocked.error.contains("不允许的字符"));
    }

    #[test]
    fn scan_missing_dirs_returns_empty() {
        let fixture = ScanFixture::new();
        assert!(scan_session_files(&fixture.0).unwrap().is_empty());
        assert!(scan_session_files_with_preview(&fixture.0)
            .unwrap()
            .is_empty());
        assert!(scan_session_files(&fixture.0.join("missing")).is_err());
    }

    #[test]
    fn parses_jsonl_preview() {
        let tmp = std::env::temp_dir().join("wb-test-session.jsonl");
        let mut f = std::fs::File::create(&tmp).unwrap();
        let line1 =
            r#"{"type":"user","message":{"content":[{"type":"text","text":"Hello world"}]}}"#;
        let line2 =
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hi there!"}]}}"#;
        writeln!(f, "{}", line1).unwrap();
        writeln!(f, "{}", line2).unwrap();
        let (count, first, last) = parse_jsonl_preview(tmp.to_str().unwrap()).unwrap();
        assert_eq!(count, 2);
        assert!(first.contains("Hello"));
        assert!(last.contains("Hi"));
    }

    #[test]
    fn open_session_file_rejects_replaced_path() {
        // 打开前把路径换成另一个文件：类型仍是普通文件，只有身份校验能发现。
        let dir = std::env::temp_dir().join(format!("wb-replace-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let original = dir.join("session.jsonl");
        let other = dir.join("other.jsonl");
        std::fs::write(&original, b"original").unwrap();
        std::fs::write(&other, b"a different file").unwrap();

        let before = fs::symlink_metadata(&original).unwrap();
        std::fs::remove_file(&original).unwrap();
        // 用改名而不是写回：创建时间会明显不同
        std::fs::rename(&other, &original).unwrap();
        let after = fs::symlink_metadata(&original).unwrap();

        assert!(
            !same_file_identity(&before, &after),
            "replaced file must not share identity"
        );

        // 未替换的正常文件仍应能打开
        std::fs::write(dir.join("stable.jsonl"), b"stable").unwrap();
        assert!(open_session_file(&dir.join("stable.jsonl")).is_ok());

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
