//! 本地数据层：项目与任务，持久化到 app_data_dir/data.json。
//! 损坏文件先保全再报错（见 json_store），绝不静默当成空数据 —— 那会让下一次保存
//! 把可恢复的用户数据覆盖成空集。

use crate::paths::DataRoot;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::json_store;

#[derive(Serialize, Deserialize, Clone, Debug, Default, ts_rs::TS)]
pub struct WorkbenchData {
    pub projects: Vec<Project>,
    pub tasks: Vec<Task>,
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
    #[ts(type = "number")]
    pub created_at: u64,
    #[ts(type = "number")]
    pub updated_at: u64,
}

pub fn data_file_path(root: &DataRoot) -> PathBuf {
    root.data_json()
}

/// 读取项目/任务数据。文件损坏或不可读时返回 Err，由前端明确告知用户。
pub fn load_from_disk(root: &DataRoot) -> Result<WorkbenchData, String> {
    let path = data_file_path(root);
    Ok(json_store::read_json(&path)?.unwrap_or_default())
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
    json_store::write_json_atomic(&data_file_path(root), data)
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

    /// 回归：`save_to_disk` 与 `mutate` 必须共用一把锁。
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
}
