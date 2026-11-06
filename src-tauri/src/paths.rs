//! 数据目录解析，桌面壳与无界面服务共用。
//!
//! 为什么单独成一个模块：`cost_store` / `data` 原先直接吃 `&AppHandle` 才能
//! 拿到 `app_data_dir()`，这让它们只能在 Tauri 进程里运行 —— `workbench serve`
//! 与 HTTP API 想要复用同一套聚合逻辑，就得先把每条路径重写一遍。
//! 改成「先解析出根目录，再把根目录传下去」之后，持久层只依赖 `&Path`，
//! 桌面、CLI、Web 服务三条入口共享同一份实现，也就不会各写一套而产生口径漂移。
//!
//! 目录约定（与 Tauri 的 `app_data_dir` 完全一致，历史数据无需迁移）：
//! - Windows: `%APPDATA%\com.workbench.desktop`
//! - macOS:   `~/Library/Application Support/com.workbench.desktop`
//! - Linux:   `$XDG_DATA_HOME/com.workbench.desktop` 或 `~/.local/share/com.workbench.desktop`
//!
//! `WORKBENCH_DATA_DIR` 可整体覆盖，测试与便携模式用得上。

use std::path::{Path, PathBuf};

pub const APP_IDENTIFIER: &str = "com.workbench.desktop";

/// 数据根目录：所有持久化文件都在它下面。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DataRoot {
    root: PathBuf,
}

impl DataRoot {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// 按平台约定解析。`WORKBENCH_DATA_DIR` 优先。
    pub fn resolve() -> Result<Self, String> {
        if let Some(v) = std::env::var_os("WORKBENCH_DATA_DIR") {
            if !v.is_empty() {
                return Ok(Self::new(v));
            }
        }
        let base = platform_data_base()
            .ok_or_else(|| "无法定位系统数据目录（请设置 WORKBENCH_DATA_DIR）".to_string())?;
        Ok(Self::new(base.join(APP_IDENTIFIER)))
    }

    pub fn as_path(&self) -> &Path {
        &self.root
    }

    /// 确保目录存在，返回自身（便于链式调用）。
    pub fn ensure(&self) -> Result<&Self, String> {
        std::fs::create_dir_all(&self.root)
            .map_err(|e| format!("无法创建数据目录 {}: {e}", self.root.display()))?;
        Ok(self)
    }

    pub fn join(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }

    pub fn data_json(&self) -> PathBuf {
        self.join("data.json")
    }

    pub fn cost_db(&self) -> PathBuf {
        self.join("cost.db")
    }

    pub fn legacy_cost_json(&self) -> PathBuf {
        self.join("cost_data.json")
    }

    pub fn pricing_overrides(&self) -> PathBuf {
        self.join("pricing_overrides.json")
    }

    pub fn log_file(&self) -> PathBuf {
        self.join("workbench.log")
    }

    pub fn backups_dir(&self) -> PathBuf {
        self.join("backups")
    }
}

#[cfg(windows)]
fn platform_data_base() -> Option<PathBuf> {
    std::env::var_os("APPDATA")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

#[cfg(target_os = "macos")]
fn platform_data_base() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .filter(|v| !v.is_empty())
        .map(|h| PathBuf::from(h).join("Library").join("Application Support"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn platform_data_base() -> Option<PathBuf> {
    if let Some(v) = std::env::var_os("XDG_DATA_HOME").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(v));
    }
    std::env::var_os("HOME")
        .filter(|v| !v.is_empty())
        .map(|h| PathBuf::from(h).join(".local").join("share"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_expected_file_names() {
        let root = DataRoot::new("/tmp/wb-test");
        assert_eq!(root.data_json(), PathBuf::from("/tmp/wb-test/data.json"));
        assert_eq!(root.cost_db(), PathBuf::from("/tmp/wb-test/cost.db"));
        assert_eq!(
            root.pricing_overrides(),
            PathBuf::from("/tmp/wb-test/pricing_overrides.json")
        );
        assert_eq!(root.backups_dir(), PathBuf::from("/tmp/wb-test/backups"));
    }

    #[test]
    fn env_override_wins() {
        std::env::set_var("WORKBENCH_DATA_DIR", "/tmp/wb-override");
        let root = DataRoot::resolve().expect("override should resolve");
        assert_eq!(root.as_path(), Path::new("/tmp/wb-override"));
        std::env::remove_var("WORKBENCH_DATA_DIR");
    }

    /// 空字符串等同于未设置：否则 `WORKBENCH_DATA_DIR=` 会把数据写到当前目录。
    #[test]
    fn empty_env_override_is_ignored() {
        std::env::set_var("WORKBENCH_DATA_DIR", "");
        let root = DataRoot::resolve().expect("platform default should resolve");
        assert_ne!(root.as_path(), Path::new(""));
        std::env::remove_var("WORKBENCH_DATA_DIR");
    }
}
