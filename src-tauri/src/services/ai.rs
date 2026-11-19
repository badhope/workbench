//! 受控 AI 写入服务。
//!
//! 设计硬约束：
//! - 默认关闭，只允许白名单工具；
//! - 任务写入走 `data::mutate`，知识追加只能落在已配置的知识目录内；
//! - 每次写入先落审计，再返回；审计失败时回滚写入；
//! - 撤销按写入前的快照恢复，文件被外部改过则拒绝。

use crate::data::{self, Task};
use crate::json_store;
use crate::knowledge;
use crate::paths::DataRoot;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_ACTIONS: usize = 200;
const MAX_APPEND_BYTES: usize = 64 * 1024;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
static AI_LOCK: Mutex<()> = Mutex::new(());
static ACTION_SEQ: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Deserialize, Clone, Debug, Default, ts_rs::TS)]
pub struct AiConfig {
    /// 是否允许外部 AI 通过 MCP 写入。默认 false。
    pub allow_writes: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, ts_rs::TS)]
pub struct AiAction {
    pub id: String,
    #[ts(type = "number")]
    pub at: u64,
    pub tool: String,
    pub target: String,
    pub summary: String,
    pub undone: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct StoredAiAction {
    #[serde(flatten)]
    public: AiAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    before: Option<Task>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    after: Option<Task>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    previous_len: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    after_len: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    after_mtime: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    after_hash: Option<u64>,
}

#[derive(Deserialize, JsonSchema)]
pub struct TaskCreateArgs {
    pub title: String,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub due: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub next_step: Option<String>,
    #[serde(default)]
    pub blocked_reason: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
pub struct TaskUpdateArgs {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    /// 空字符串表示清除截止日。
    #[serde(default)]
    pub due: Option<String>,
    /// 空字符串表示移出项目。
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub next_step: Option<String>,
    #[serde(default)]
    pub blocked_reason: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
pub struct KnowledgeAppendArgs {
    /// 已索引笔记的绝对路径，必须位于配置的知识目录内。
    pub path: String,
    /// Markdown 片段；最多 64 KB。
    pub content: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct ActionListArgs {
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Deserialize, JsonSchema)]
pub struct ActionUndoArgs {
    pub id: String,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn new_action_id() -> String {
    let seq = ACTION_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("a{}-{seq}", now_millis())
}

fn clean(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn config_path(root: &DataRoot) -> PathBuf {
    root.ai_config()
}

fn actions_path(root: &DataRoot) -> PathBuf {
    root.ai_actions()
}

fn load_config_unlocked(root: &DataRoot) -> Result<AiConfig, String> {
    Ok(json_store::read_json(&config_path(root))?.unwrap_or_default())
}

pub fn config(root: &DataRoot) -> Result<AiConfig, String> {
    load_config_unlocked(root)
}

pub fn allow_writes(root: &DataRoot) -> Result<bool, String> {
    Ok(config(root)?.allow_writes)
}

fn ensure_writes_enabled(root: &DataRoot) -> Result<(), String> {
    if allow_writes(root)? {
        Ok(())
    } else {
        Err("AI 写入未开启，请先在设置页允许 AI 写入".to_string())
    }
}

pub fn set_allow_writes(root: &DataRoot, allow: bool) -> Result<AiConfig, String> {
    let _guard = AI_LOCK.lock().map_err(|_| "AI 写入服务忙碌".to_string())?;
    let cfg = AiConfig {
        allow_writes: allow,
    };
    json_store::write_json_atomic(&config_path(root), &cfg)?;
    Ok(cfg)
}

fn load_actions(root: &DataRoot) -> Result<Vec<StoredAiAction>, String> {
    Ok(json_store::read_json(&actions_path(root))?.unwrap_or_default())
}

fn save_actions(root: &DataRoot, actions: &[StoredAiAction]) -> Result<(), String> {
    json_store::write_json_atomic(&actions_path(root), &actions)
}

fn push_action_unlocked(root: &DataRoot, mut action: StoredAiAction) -> Result<AiAction, String> {
    let mut actions = load_actions(root)?;
    actions.push(action.clone());
    if actions.len() > MAX_ACTIONS {
        let excess = actions.len() - MAX_ACTIONS;
        actions.drain(0..excess);
    }
    save_actions(root, &actions)?;
    action.public.undone = false;
    Ok(action.public)
}

fn make_action(tool: &str, target: String, summary: String) -> StoredAiAction {
    StoredAiAction {
        public: AiAction {
            id: new_action_id(),
            at: now_secs(),
            tool: tool.to_string(),
            target,
            summary,
            undone: false,
        },
        before: None,
        after: None,
        previous_len: None,
        after_len: None,
        after_mtime: None,
        after_hash: None,
    }
}

fn validate_status(status: &str) -> Result<(), String> {
    matches!(status, "todo" | "doing" | "done")
        .then_some(())
        .ok_or_else(|| "status 只能是 todo / doing / done".to_string())
}

fn validate_priority(priority: &str) -> Result<(), String> {
    matches!(priority, "low" | "normal" | "high")
        .then_some(())
        .ok_or_else(|| "priority 只能是 low / normal / high".to_string())
}

fn ensure_project(data: &data::WorkbenchData, project_id: Option<&str>) -> Result<(), String> {
    if let Some(id) = project_id.filter(|s| !s.is_empty()) {
        if !data.projects.iter().any(|p| p.id == id) {
            return Err(format!("项目不存在: {id}"));
        }
    }
    Ok(())
}

fn apply_update(
    data: &data::WorkbenchData,
    before: &Task,
    args: &TaskUpdateArgs,
    now: u64,
) -> Result<Task, String> {
    let mut next = before.clone();
    if let Some(title) = args.title.as_ref() {
        let title = title.trim();
        if title.is_empty() {
            return Err("title 不能为空".to_string());
        }
        next.title = title.to_string();
    }
    if let Some(status) = args.status.as_ref() {
        validate_status(status)?;
        if status != &before.status {
            next.completed_at = if status == "done" { Some(now) } else { None };
        }
        next.status = status.clone();
    }
    if let Some(priority) = args.priority.as_ref() {
        validate_priority(priority)?;
        next.priority = priority.clone();
    }
    if let Some(due) = args.due.as_ref() {
        next.due = clean(Some(due.clone()));
    }
    if let Some(project_id) = args.project_id.as_ref() {
        let id = clean(Some(project_id.clone()));
        ensure_project(data, id.as_deref())?;
        next.project_id = id;
    }
    if let Some(tags) = args.tags.as_ref() {
        next.tags = tags
            .iter()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect();
    }
    if let Some(next_step) = args.next_step.as_ref() {
        next.next_step = clean(Some(next_step.clone()));
    }
    if let Some(reason) = args.blocked_reason.as_ref() {
        next.blocked_reason = clean(Some(reason.clone()));
    }
    next.updated_at = now;
    Ok(next)
}

pub fn task_create(root: &DataRoot, args: TaskCreateArgs) -> Result<AiAction, String> {
    let _guard = AI_LOCK.lock().map_err(|_| "AI 写入服务忙碌".to_string())?;
    ensure_writes_enabled(root)?;
    let title = args.title.trim();
    if title.is_empty() {
        return Err("title 不能为空".to_string());
    }
    if title.chars().count() > 200 {
        return Err("title 不能超过 200 字".to_string());
    }
    let status = args.status.as_deref().unwrap_or("todo").to_string();
    validate_status(&status)?;
    let priority = args.priority.as_deref().unwrap_or("normal").to_string();
    validate_priority(&priority)?;
    let now = now_secs();
    let project_id = clean(args.project_id);
    let task = Task {
        id: format!("t{}-{}", now, ACTION_SEQ.fetch_add(1, Ordering::Relaxed)),
        title: title.to_string(),
        status: status.clone(),
        priority,
        due: clean(args.due),
        project_id: project_id.clone(),
        tags: args
            .tags
            .into_iter()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect(),
        next_step: clean(args.next_step),
        blocked_reason: clean(args.blocked_reason),
        completed_at: (status == "done").then_some(now),
        created_at: now,
        updated_at: now,
    };
    let created = data::mutate(root, |data| {
        if let Err(e) = ensure_project(data, project_id.as_deref()) {
            return (Err(e), false);
        }
        data.tasks.insert(0, task.clone());
        (Ok(task.clone()), true)
    })??;
    let mut action = make_action(
        "task_create",
        created.id.clone(),
        format!("创建任务：{}", created.title),
    );
    action.after = Some(created.clone());
    match push_action_unlocked(root, action) {
        Ok(action) => Ok(action),
        Err(e) => {
            let id = created.id.clone();
            let _ = data::mutate(root, |data| {
                if let Some(pos) = data.tasks.iter().position(|t| t.id == id) {
                    if same_task(&data.tasks[pos], &created) {
                        data.tasks.remove(pos);
                    }
                }
                ((), true)
            });
            Err(format!("写入审计失败，已回滚: {e}"))
        }
    }
}

pub fn task_update(root: &DataRoot, args: TaskUpdateArgs) -> Result<AiAction, String> {
    let _guard = AI_LOCK.lock().map_err(|_| "AI 写入服务忙碌".to_string())?;
    ensure_writes_enabled(root)?;
    let now = now_secs();
    let id = args.id.clone();
    let (before, after) = data::mutate(root, |data| {
        let Some(pos) = data.tasks.iter().position(|t| t.id == id) else {
            return (Err(format!("任务不存在: {id}")), false);
        };
        let before = data.tasks[pos].clone();
        let after = match apply_update(data, &before, &args, now) {
            Ok(t) => t,
            Err(e) => return (Err(e), false),
        };
        data.tasks[pos] = after.clone();
        (Ok((before, after)), true)
    })??;
    let mut action = make_action(
        "task_update",
        after.id.clone(),
        format!("更新任务：{}", after.title),
    );
    action.before = Some(before.clone());
    action.after = Some(after.clone());
    match push_action_unlocked(root, action) {
        Ok(action) => Ok(action),
        Err(e) => {
            let _ = data::mutate(root, |data| {
                if let Some(t) = data.tasks.iter_mut().find(|t| t.id == before.id) {
                    if same_task(t, &after) {
                        *t = before.clone();
                    }
                }
                ((), true)
            });
            Err(format!("写入审计失败，已回滚: {e}"))
        }
    }
}

pub fn knowledge_append(root: &DataRoot, args: KnowledgeAppendArgs) -> Result<AiAction, String> {
    let _guard = AI_LOCK.lock().map_err(|_| "AI 写入服务忙碌".to_string())?;
    ensure_writes_enabled(root)?;
    let content = args.content.as_str();
    if content.trim().is_empty() {
        return Err("content 不能为空".to_string());
    }
    if content.len() > MAX_APPEND_BYTES {
        return Err("content 超过 64 KB".to_string());
    }
    let path = knowledge::resolve_doc(root, &args.path)?;
    if !knowledge::is_markdown(&path) {
        return Err("只允许追加 Markdown/文本笔记".to_string());
    }
    let meta = fs::metadata(&path).map_err(|e| format!("读取知识文件失败: {e}"))?;
    if meta.len() > MAX_FILE_BYTES {
        return Err("知识文件超过 2 MB，拒绝追加".to_string());
    }
    let raw = fs::read(&path).map_err(|e| format!("读取知识文件失败: {e}"))?;
    let mut addition = Vec::new();
    if !raw.last().map(|b| *b == b'\n').unwrap_or(false) {
        addition.push(b'\n');
    }
    addition.extend_from_slice(content.as_bytes());
    if !content.ends_with('\n') {
        addition.push(b'\n');
    }
    if raw.len() as u64 + addition.len() as u64 > MAX_FILE_BYTES {
        return Err("追加后文件会超过 2 MB".to_string());
    }
    let previous_len = raw.len() as u64;
    let mut file = OpenOptions::new()
        .append(true)
        .open(&path)
        .map_err(|e| format!("打开知识文件失败: {e}"))?;
    file.write_all(&addition)
        .and_then(|_| file.flush())
        .map_err(|e| format!("追加知识文件失败: {e}"))?;
    let after_meta = fs::metadata(&path).map_err(|e| format!("读取知识文件失败: {e}"))?;
    let after_len = after_meta.len();
    let after_mtime = after_meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let after_hash = fnv1a(&fs::read(&path).map_err(|e| format!("读取知识文件失败: {e}"))?);
    let mut action = make_action(
        "knowledge_append",
        path.display().to_string(),
        format!("追加笔记：{}", path.display()),
    );
    action.previous_len = Some(previous_len);
    action.after_len = Some(after_len);
    action.after_mtime = Some(after_mtime);
    action.after_hash = Some(after_hash);
    match push_action_unlocked(root, action) {
        Ok(action) => {
            // 索引是可重建缓存；即使重建失败，文件也已经安全追加。
            if let Err(e) = knowledge::reindex(root) {
                log::warn!("AI 追加后重建知识索引失败: {e}");
            }
            Ok(action)
        }
        Err(e) => {
            if let Ok(current) = fs::read(&path) {
                if current.len() as u64 == after_len && fnv1a(&current) == after_hash {
                    let _ = OpenOptions::new()
                        .write(true)
                        .open(&path)
                        .and_then(|f| f.set_len(previous_len));
                }
            }
            Err(format!("写入审计失败，已回滚: {e}"))
        }
    }
}

pub fn actions(root: &DataRoot, limit: Option<usize>) -> Result<Vec<AiAction>, String> {
    let limit = limit.unwrap_or(50).clamp(1, MAX_ACTIONS);
    let actions = load_actions(root)?;
    Ok(actions
        .into_iter()
        .rev()
        .take(limit)
        .map(|a| a.public)
        .collect())
}

fn same_task(a: &Task, b: &Task) -> bool {
    serde_json::to_value(a).ok() == serde_json::to_value(b).ok()
}

pub fn undo(root: &DataRoot, id: &str) -> Result<AiAction, String> {
    let _guard = AI_LOCK.lock().map_err(|_| "AI 写入服务忙碌".to_string())?;
    ensure_writes_enabled(root)?;
    let mut actions = load_actions(root)?;
    let Some(pos) = actions.iter().position(|a| a.public.id == id) else {
        return Err(format!("操作不存在: {id}"));
    };
    if actions[pos].public.undone {
        return Err("该操作已经撤销".to_string());
    }
    let stored = actions[pos].clone();
    match stored.public.tool.as_str() {
        "task_create" => {
            let after = stored.after.ok_or_else(|| "审计缺少任务快照".to_string())?;
            let target = after.id.clone();
            data::mutate(root, |data| {
                let Some(pos) = data.tasks.iter().position(|t| t.id == target) else {
                    return (Err("任务已不存在，无法撤销".to_string()), false);
                };
                if !same_task(&data.tasks[pos], &after) {
                    return (Err("任务已被其他操作修改，拒绝撤销".to_string()), false);
                }
                data.tasks.remove(pos);
                (Ok(()), true)
            })??;
        }
        "task_update" => {
            let before = stored
                .before
                .ok_or_else(|| "审计缺少修改前快照".to_string())?;
            let after = stored
                .after
                .ok_or_else(|| "审计缺少修改后快照".to_string())?;
            let target = before.id.clone();
            data::mutate(root, |data| {
                let Some(pos) = data.tasks.iter().position(|t| t.id == target) else {
                    return (Err("任务已不存在，无法撤销".to_string()), false);
                };
                if !same_task(&data.tasks[pos], &after) {
                    return (Err("任务已被其他操作修改，拒绝撤销".to_string()), false);
                }
                data.tasks[pos] = before.clone();
                (Ok(()), true)
            })??;
        }
        "knowledge_append" => {
            let path = knowledge::resolve_doc(root, &stored.public.target)?;
            let meta = fs::metadata(&path).map_err(|e| format!("读取知识文件失败: {e}"))?;
            let expected_len = stored
                .after_len
                .ok_or_else(|| "审计缺少文件长度".to_string())?;
            let expected_mtime = stored
                .after_mtime
                .ok_or_else(|| "审计缺少文件时间".to_string())?;
            let actual_mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let expected_hash = stored
                .after_hash
                .ok_or_else(|| "审计缺少文件指纹".to_string())?;
            let current = fs::read(&path).map_err(|e| format!("读取知识文件失败: {e}"))?;
            if current.len() as u64 != expected_len
                || actual_mtime != expected_mtime
                || fnv1a(&current) != expected_hash
            {
                return Err("笔记已被外部修改，拒绝撤销".to_string());
            }
            let previous_len = stored
                .previous_len
                .ok_or_else(|| "审计缺少原始长度".to_string())?;
            OpenOptions::new()
                .write(true)
                .open(&path)
                .and_then(|f| f.set_len(previous_len))
                .map_err(|e| format!("撤销追加失败: {e}"))?;
            if let Err(e) = knowledge::reindex(root) {
                log::warn!("AI 撤销后重建知识索引失败: {e}");
            }
        }
        other => return Err(format!("不支持的撤销工具: {other}")),
    }
    actions[pos].public.undone = true;
    save_actions(root, &actions)?;
    Ok(actions[pos].public.clone())
}

fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> DataRoot {
        let path = std::env::temp_dir().join(format!(
            "wb-ai-{tag}-{}-{}",
            now_millis(),
            ACTION_SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).expect("创建测试目录失败");
        DataRoot::new(&path)
    }

    fn task_args(title: &str) -> TaskCreateArgs {
        TaskCreateArgs {
            title: title.to_string(),
            status: None,
            priority: None,
            due: None,
            project_id: None,
            tags: Vec::new(),
            next_step: None,
            blocked_reason: None,
        }
    }

    #[test]
    fn writes_are_disabled_by_default() {
        let root = temp_root("disabled");
        let err = task_create(&root, task_args("不应写入")).expect_err("默认必须拒绝");
        assert!(err.contains("未开启"), "{err}");
        assert!(!allow_writes(&root).unwrap());
    }

    #[test]
    fn task_create_update_and_undo_are_audited() {
        let root = temp_root("tasks");
        set_allow_writes(&root, true).unwrap();
        let created = task_create(&root, task_args("写一个受控任务")).unwrap();
        assert_eq!(created.tool, "task_create");
        let data = data::load_from_disk(&root).unwrap();
        assert_eq!(data.tasks.len(), 1);
        let id = data.tasks[0].id.clone();

        let updated = task_update(
            &root,
            TaskUpdateArgs {
                id: id.clone(),
                title: Some("改名后的任务".to_string()),
                status: Some("done".to_string()),
                priority: Some("high".to_string()),
                due: None,
                project_id: None,
                tags: None,
                next_step: None,
                blocked_reason: None,
            },
        )
        .unwrap();
        assert_eq!(updated.tool, "task_update");
        let data = data::load_from_disk(&root).unwrap();
        let task = &data.tasks[0];
        assert_eq!(task.title, "改名后的任务");
        assert_eq!(task.status, "done");
        assert!(task.completed_at.is_some());

        let undone = undo(&root, &updated.id).unwrap();
        assert!(undone.undone);
        let data = data::load_from_disk(&root).unwrap();
        let task = &data.tasks[0];
        assert_eq!(task.title, "写一个受控任务");
        assert_eq!(task.status, "todo");
        assert!(task.completed_at.is_none());

        undo(&root, &created.id).unwrap();
        assert_eq!(data::load_from_disk(&root).unwrap().tasks.len(), 0);
        let actions = actions(&root, None).unwrap();
        assert_eq!(actions.len(), 2);
        assert!(actions.iter().all(|a| a.undone));
    }

    #[test]
    fn knowledge_append_is_confined_to_configured_sources() {
        let root = temp_root("notes");
        let notes = root.as_path().join("notes");
        fs::create_dir_all(&notes).unwrap();
        let note = notes.join("memo.md");
        fs::write(&note, "# 原始\n\n第一段\n").unwrap();
        knowledge::add_source(&root, notes.to_str().unwrap()).unwrap();
        set_allow_writes(&root, true).unwrap();

        let appended = knowledge_append(
            &root,
            KnowledgeAppendArgs {
                path: note.display().to_string(),
                content: "第二段".to_string(),
            },
        )
        .unwrap();
        let body = fs::read_to_string(&note).unwrap();
        assert!(body.contains("第二段"), "{body}");

        undo(&root, &appended.id).unwrap();
        assert_eq!(fs::read_to_string(&note).unwrap(), "# 原始\n\n第一段\n");

        let outside = root.as_path().join("outside.md");
        fs::write(&outside, "outside").unwrap();
        let err = knowledge_append(
            &root,
            KnowledgeAppendArgs {
                path: outside.display().to_string(),
                content: "不应写入".to_string(),
            },
        )
        .expect_err("目录外必须拒绝");
        assert!(err.contains("outside") || err.contains("知识目录"), "{err}");
        assert_eq!(fs::read_to_string(&outside).unwrap(), "outside");

        let script = notes.join("run.sh");
        fs::write(&script, "echo hi\n").unwrap();
        let err = knowledge_append(
            &root,
            KnowledgeAppendArgs {
                path: script.display().to_string(),
                content: "不应写入".to_string(),
            },
        )
        .expect_err("只允许笔记文件");
        assert!(err.contains("Markdown"), "{err}");
        assert_eq!(fs::read_to_string(&script).unwrap(), "echo hi\n");

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let link = notes.join("escape.md");
            symlink(&outside, &link).unwrap();
            let err = knowledge_append(
                &root,
                KnowledgeAppendArgs {
                    path: link.display().to_string(),
                    content: "符号链接不应写入".to_string(),
                },
            )
            .expect_err("符号链接逃逸必须拒绝");
            assert!(err.contains("outside") || err.contains("知识目录"), "{err}");
            assert_eq!(fs::read_to_string(&outside).unwrap(), "outside");
        }
    }
}
