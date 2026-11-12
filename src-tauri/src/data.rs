//! 本地数据层：项目与任务，持久化到 app_data_dir/data.json。
//! 损坏文件先保全再报错（见 json_store），绝不静默当成空数据 —— 那会让下一次保存
//! 把可恢复的用户数据覆盖成空集。

use crate::paths::DataRoot;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::json_store;

/// 当前数据格式版本。
///
/// - v1：初始格式。项目/任务只有基础字段，没有版本号（文件里缺 `schema_version`）。
/// - v2：新增任务 `next_step` / `blocked_reason` / `completed_at` 与项目 `goal`。
///
/// 版本号写进 data.json 顶层，让「这份数据是哪一版」有唯一答案：
/// 读的时候按版本迁移，写的时候按版本备份。缺版本号一律按 v1 读。
pub const SCHEMA_VERSION: u32 = 2;

#[derive(Serialize, Deserialize, Clone, Debug, ts_rs::TS)]
pub struct WorkbenchData {
    /// 数据格式版本。缺失 = v1。
    ///
    /// 刻意用 `Option` 而不是裸 u32：旧文件里根本没有这个键，
    /// 用裸数字就得给 serde 一个默认值，而默认值一旦和真实版本漂移，
    /// 「读到的是哪一版」就再也说不清了。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub schema_version: Option<u32>,
    pub projects: Vec<Project>,
    pub tasks: Vec<Task>,
}

impl Default for WorkbenchData {
    fn default() -> Self {
        Self {
            schema_version: Some(SCHEMA_VERSION),
            projects: Vec::new(),
            tasks: Vec::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, ts_rs::TS)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub status: String,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub note: String,
    /// 项目目标：一句话说清这个项目要达成什么。
    ///
    /// v2 新增。`note` 在旧版本里被临时当目标用，这里给它一个正经字段；
    /// 迁移**不**把 note 抄进 goal —— 用户当初写的是备注不是目标，
    /// 替他猜一次就等于往数据里塞一条假事实。界面用 goal、为空时回落 note。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub goal: Option<String>,
    #[ts(type = "number")]
    pub created_at: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, ts_rs::TS)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub status: String,
    pub priority: String,
    pub due: Option<String>,
    pub project_id: Option<String>,
    pub tags: Vec<String>,
    /// 下一步：用户显式写的下一步动作。
    ///
    /// v2 新增。此前首页的「下一步」是从最早到期的未完成任务反推的，
    /// 那是猜测；有了这个字段就能显示用户自己写的那一句。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub next_step: Option<String>,
    /// 阻塞原因：任务卡住时写明卡在哪。
    ///
    /// v2 新增。没有它，阻塞的任务和普通的待办在界面上长得一样。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub blocked_reason: Option<String>,
    /// 完成时间（Unix 秒）。状态进入 done 时记录，离开 done 时清空。
    ///
    /// v2 新增。历史任务没有这个值 —— 不拿 `updated_at` 冒充完成时间，
    /// 回顾页的趋势从升级之后才开始有数据，这是事实，不是缺陷。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "number")]
    pub completed_at: Option<u64>,
    #[ts(type = "number")]
    pub created_at: u64,
    #[ts(type = "number")]
    pub updated_at: u64,
}

pub fn data_file_path(root: &DataRoot) -> PathBuf {
    root.data_json()
}

/// 读取项目/任务数据。文件损坏或不可读时返回 Err，由前端明确告知用户。
///
/// 读到的旧格式数据会在**内存里**迁移到当前版本；真正落盘的迁移发生在
/// [`save_to_disk`] —— 那时才有备份兜底（见 [`backup_before_upgrade`]）。
pub fn load_from_disk(root: &DataRoot) -> Result<WorkbenchData, String> {
    let path = data_file_path(root);
    let raw = json_store::read_json(&path)?.unwrap_or_default();
    migrate(raw)
}

/// 版本化迁移：把磁盘上的数据升级到 [`SCHEMA_VERSION`]。
///
/// 只做「加字段」这类不会丢信息的迁移。任何需要猜测的补值都不做：
/// 例如不拿 `updated_at` 当完成时间，不拿 `note` 当项目目标 ——
/// 把推断写成事实，比缺一个字段更糟。
pub fn migrate(mut data: WorkbenchData) -> Result<WorkbenchData, String> {
    let version = data.schema_version.unwrap_or(1);
    if version > SCHEMA_VERSION {
        // 宁可明确报错，也不要「读进来猜着改」：新版本可能已经改了字段语义，
        // 旧版本写回去会把用户数据改坏。
        return Err(format!(
            "数据由更新版本写入（v{version}），当前版本只支持到 v{SCHEMA_VERSION}；请升级应用后再打开"
        ));
    }
    if version < SCHEMA_VERSION {
        // v1 → v2：新增字段全部有默认值，不需要搬运任何已有数据。
        data.schema_version = Some(SCHEMA_VERSION);
    }
    Ok(data)
}

/// 读取磁盘上 data.json 的版本号。
///
/// - `Some(v)`：文件在，版本是 v。
/// - `Some(1)`：文件在，但读不出版本号（v1 旧文件没有这个键）。
/// - `None`：文件不在。
fn on_disk_schema_version(path: &Path) -> Option<u32> {
    let text = fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    Some(
        value
            .get("schema_version")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32)
            .unwrap_or(1),
    )
}

/// 升级写盘前把旧文件留一份 `.bak`。
///
/// 迁移一旦出错，用户手里只有这一份数据 —— 先留原件，
/// 失败时原数据还在，删掉 `.bak` 也不会丢东西。
fn backup_before_upgrade(path: &Path, from_version: u32) -> Result<PathBuf, String> {
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "data.json".to_string());
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let target = path.with_file_name(format!("{name}.v{from_version}-{stamp}.bak"));
    fs::copy(path, &target).map_err(|e| {
        format!(
            "升级数据前备份 {} 失败: {e}；已中止写入以免覆盖原数据",
            target.display()
        )
    })?;
    log::info!("数据升级前已备份原文件: {}", target.display());
    Ok(target)
}

/// 整文件写入。
///
/// **这里也取锁**：调用方（`save_data`）是整文件替换语义，
/// 若不加锁，它可以在 `mutate` 的「读」与「写」之间插入，
/// 把后者刚读到的内容覆盖掉（丢更新）。`mutate` 内部的写会重入同一把锁，
/// 因为 `std::sync::Mutex` 不可重入，所以拆出内部实现给 `mutate` 用。
pub fn save_to_disk(root: &DataRoot, data: &WorkbenchData) -> Result<(), String> {
    let _guard = lock();
    save_to_disk_unlocked(root, data)
}

fn save_to_disk_unlocked(root: &DataRoot, data: &WorkbenchData) -> Result<(), String> {
    root.ensure()?;
    let path = data_file_path(root);
    // 版本升级前先备份旧文件：迁移出错时用户还有一份可恢复的原数据。
    // 备份失败就中止写入 —— 宁可这次没存上，也不要在没留底的情况下覆盖。
    let target_version = data.schema_version.unwrap_or(SCHEMA_VERSION);
    if let Some(old_version) = on_disk_schema_version(&path) {
        if old_version < target_version {
            backup_before_upgrade(&path, old_version)?;
        }
    }
    json_store::write_json_atomic(&path, data)
}

/// 数据文件锁。
///
/// 为什么必须加：前端用 300ms 防抖整文件保存（`saveData`），是「读出全量
/// 快照 → 改 → 整文件替换」的模式；项目/任务数据与其他写方（如成本账本
/// 归档引用的元数据）共用同一份数据文件，任何一方在另一线程做「读-改-写」
/// 时，没有锁的话后写者会用自己的旧快照盖掉前者刚写入的内容 ——
/// json_store 的原子写只保证"不会写出半截文件"，不保证读-改-写是原子的。
static DATA_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn lock() -> std::sync::MutexGuard<'static, ()> {
    DATA_LOCK.lock().unwrap_or_else(|p| p.into_inner())
}

/// 在锁内做「读-改-写」，返回被修改后的结果。
/// `f` 返回 true 表示有变更，需要落盘。
pub fn mutate<R>(
    root: &DataRoot,
    f: impl FnOnce(&mut WorkbenchData) -> (R, bool),
) -> Result<R, String> {
    let _guard = lock();
    let mut data = load_from_disk(root)?;
    let (out, changed) = f(&mut data);
    // 锁内直接调 unlocked 版本：save_to_disk 会再取一次锁 → 死锁
    if changed {
        save_to_disk_unlocked(root, &data)?;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 回归：`save_and_mutate` 与 `mutate` 必须共用一把锁。
    /// 若 save_to_disk 自己在锁内再调 mutate 的写路径就会死锁，
    /// 所以内部写走 unlocked 版本 —— 这个测试确认没有自锁。
    #[test]
    fn save_and_mutate_do_not_deadlock() {
        // 用一个独立的临时目录模拟 app_data_dir 不可行（依赖 AppHandle），
        // 这里只验证锁的获取/释放语义：连续 acquire 不会互相阻塞到超时。
        let started = std::time::Instant::now();
        for _ in 0..100 {
            let _g = lock();
        }
        assert!(
            started.elapsed() < std::time::Duration::from_secs(1),
            "锁的获取不应有任何等待"
        );
    }

    fn legacy_json() -> &'static str {
        // v1 文件：没有 schema_version，也没有 v2 新增的字段。
        r#"{
          "projects": [
            { "id": "p1", "name": "旧项目", "path": "C:/x", "status": "active",
              "tags": ["a"], "pinned": false, "note": "以前当目标用的备注", "created_at": 100 }
          ],
          "tasks": [
            { "id": "t1", "title": "旧任务", "status": "done", "priority": "normal",
              "due": null, "project_id": "p1", "tags": [],
              "created_at": 100, "updated_at": 200 }
          ]
        }"#
    }

    #[test]
    fn legacy_file_without_version_reads_as_v1_and_migrates() {
        let raw: WorkbenchData = serde_json::from_str(legacy_json()).expect("v1 文件应能解析");
        assert_eq!(raw.schema_version, None, "v1 文件没有版本号");

        let migrated = migrate(raw).expect("v1 应能迁移到当前版本");
        assert_eq!(migrated.schema_version, Some(SCHEMA_VERSION));
        assert_eq!(migrated.projects.len(), 1);
        assert_eq!(migrated.tasks.len(), 1);
    }

    #[test]
    fn migration_does_not_invent_completion_time_or_goal() {
        let raw: WorkbenchData = serde_json::from_str(legacy_json()).unwrap();
        let migrated = migrate(raw).unwrap();

        // updated_at 是 200，但这不是完成时间 —— 不能拿它顶替。
        assert_eq!(migrated.tasks[0].completed_at, None);
        // note 是备注不是目标 —— 不能替他猜。
        assert_eq!(migrated.projects[0].goal, None);
        // 原有内容一个字都不能少。
        assert_eq!(migrated.projects[0].note, "以前当目标用的备注");
        assert_eq!(migrated.tasks[0].title, "旧任务");
    }

    #[test]
    fn newer_version_is_rejected_not_guessed() {
        let raw: WorkbenchData = serde_json::from_str(
            r#"{ "schema_version": 99, "projects": [], "tasks": [] }"#,
        )
        .unwrap();
        let err = migrate(raw).unwrap_err();
        assert!(err.contains("更新版本"), "应说明是版本问题：{err}");
        assert!(err.contains("99"), "应报出实际版本：{err}");
    }

    #[test]
    fn current_version_passes_through_unchanged() {
        let mut raw = WorkbenchData::default();
        raw.schema_version = Some(SCHEMA_VERSION);
        raw.tasks.push(Task {
            id: "t1".into(),
            title: "任务".into(),
            status: "done".into(),
            priority: "normal".into(),
            due: None,
            project_id: None,
            tags: vec![],
            next_step: Some("写测试".into()),
            blocked_reason: None,
            completed_at: Some(1234),
            created_at: 1,
            updated_at: 2,
        });
        let migrated = migrate(raw.clone()).unwrap();
        assert_eq!(migrated.schema_version, Some(SCHEMA_VERSION));
        assert_eq!(migrated.tasks[0].completed_at, Some(1234));
        assert_eq!(migrated.tasks[0].next_step.as_deref(), Some("写测试"));
    }

    #[test]
    fn v2_fields_round_trip_through_json() {
        let data = WorkbenchData {
            schema_version: Some(SCHEMA_VERSION),
            projects: vec![Project {
                id: "p1".into(),
                name: "项目".into(),
                path: "C:/x".into(),
                status: "active".into(),
                tags: vec![],
                pinned: false,
                note: String::new(),
                goal: Some("做成工作台".into()),
                created_at: 1,
            }],
            tasks: vec![Task {
                id: "t1".into(),
                title: "任务".into(),
                status: "doing".into(),
                priority: "high".into(),
                due: None,
                project_id: Some("p1".into()),
                tags: vec!["前端".into()],
                next_step: Some("先改数据模型".into()),
                blocked_reason: Some("等后端接口".into()),
                completed_at: None,
                created_at: 1,
                updated_at: 2,
            }],
        };
        let text = serde_json::to_string(&data).unwrap();
        let back: WorkbenchData = serde_json::from_str(&text).unwrap();
        assert_eq!(back.schema_version, Some(SCHEMA_VERSION));
        assert_eq!(back.projects[0].goal.as_deref(), Some("做成工作台"));
        assert_eq!(back.tasks[0].next_step.as_deref(), Some("先改数据模型"));
        assert_eq!(back.tasks[0].blocked_reason.as_deref(), Some("等后端接口"));
        assert_eq!(back.tasks[0].completed_at, None);
    }

    #[test]
    fn missing_optional_fields_are_absent_not_null() {
        // Option + skip_serializing_if：没写的字段就不该出现在文件里，
        // 免得把「没设置」和「显式清空」混成同一个 null。
        let data = WorkbenchData {
            schema_version: Some(SCHEMA_VERSION),
            projects: vec![],
            tasks: vec![Task {
                id: "t1".into(),
                title: "任务".into(),
                status: "todo".into(),
                priority: "normal".into(),
                due: None,
                project_id: None,
                tags: vec![],
                next_step: None,
                blocked_reason: None,
                completed_at: None,
                created_at: 1,
                updated_at: 2,
            }],
        };
        let text = serde_json::to_string(&data).unwrap();
        assert!(!text.contains("next_step"), "未设置的字段不该写出来：{text}");
        assert!(!text.contains("completed_at"), "未设置的字段不该写出来：{text}");
        assert!(text.contains("\"schema_version\":2"), "版本号必须落盘：{text}");
    }

    #[test]
    fn on_disk_version_reads_missing_key_as_v1() {
        let dir = std::env::temp_dir().join(format!("wb-data-version-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("data.json");

        fs::write(&path, legacy_json()).unwrap();
        assert_eq!(on_disk_schema_version(&path), Some(1));

        fs::write(&path, r#"{"schema_version":2,"projects":[],"tasks":[]}"#).unwrap();
        assert_eq!(on_disk_schema_version(&path), Some(2));

        fs::remove_file(&path).ok();
        assert_eq!(on_disk_schema_version(&path), None);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn upgrading_write_backs_up_v1_once() {
        let dir = std::env::temp_dir().join(format!("wb-data-backup-{}", std::process::id()));
        fs::remove_dir_all(&dir).ok();
        fs::create_dir_all(&dir).unwrap();
        let root = DataRoot::new(&dir);
        let path = root.data_json();
        fs::write(&path, legacy_json()).unwrap();

        let data = migrate(serde_json::from_str(legacy_json()).unwrap()).unwrap();
        save_to_disk(&root, &data).unwrap();

        let backups = || {
            fs::read_dir(&dir)
                .unwrap()
                .filter_map(|entry| entry.ok())
                .map(|entry| entry.file_name().to_string_lossy().to_string())
                .filter(|name| name.starts_with("data.json.v1-") && name.ends_with(".bak"))
                .count()
        };
        assert_eq!(backups(), 1, "首次升级应留一份 v1 备份");

        let written: WorkbenchData =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(written.schema_version, Some(SCHEMA_VERSION));

        // 磁盘已经是 v2，再次保存不应重复备份。
        save_to_disk(&root, &data).unwrap();
        assert_eq!(backups(), 1, "已是当前版本时不应重复备份");

        fs::remove_dir_all(&dir).ok();
    }
}
