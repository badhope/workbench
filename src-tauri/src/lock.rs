//! 跨进程文件锁。
//!
//! 为什么需要：`data.json` 是整文件「读-改-写」。进程内的 `Mutex` 只能挡住
//! 同一个进程里的线程；`workbench serve` 与桌面端是两个独立进程，各自持有
//! 自己的锁，A 读快照 → B 读快照 → A 写 → B 写，B 就把 A 的修改盖掉了。
//! 备份/恢复与成本库也有同样的问题。
//!
//! 实现取舍：不引入第三方 crate，直接用各平台的原生 advisory lock：
//! - Windows：`LockFileEx`（独占、不阻塞等待 → 用重试模拟超时）
//! - Unix：`flock(LOCK_EX | LOCK_NB)`
//!
//! 锁文件放在数据目录下（`<root>/.workbench.lock`），与数据同生命周期：
//! 数据目录被整体拷走时锁文件跟着走，但锁本身不携带任何数据。
//!
//! 语义：**同一时刻只允许一个进程写**。读不取锁 —— 读的是原子替换后的
//! 完整文件，最多读到上一版，不会读到半截。这与 `json_store` 的原子写配合。

use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// 默认等待上限。前端保存是 300ms 防抖，扫描可能几十秒；
/// 等 10 秒足够覆盖正常争用，又不至于让 UI 卡到「像死机」。
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);
const RETRY_INTERVAL: Duration = Duration::from_millis(50);

/// 持锁期间有效；`Drop` 时自动释放。
pub struct CrossProcessLock {
    file: File,
    path: PathBuf,
}

impl CrossProcessLock {
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for CrossProcessLock {
    fn drop(&mut self) {
        // 显式解锁：Windows 上关闭句柄即释放，但显式解锁语义更清楚，
        // 也避免某些文件系统上延迟释放导致的「刚退出又抢不到锁」。
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            unsafe {
                let handle = self.file.as_raw_handle();
                let mut overlapped = std::mem::zeroed();
                let _ = LockFileEx(
                    handle as RawHandle,
                    LOCKFILE_RELEASE,
                    0,
                    MAXDWORD,
                    MAXDWORD,
                    &mut overlapped,
                );
            }
        }
        #[cfg(unix)]
        {
            use std::os::unix::io::AsRawFd;
            unsafe {
                let _ = flock(self.file.as_raw_fd(), LOCK_UN);
            }
        }
    }
}

#[cfg(windows)]
type RawHandle = *mut std::ffi::c_void;
#[cfg(windows)]
const LOCKFILE_FAIL_IMMEDIATELY: u32 = 0x1;
#[cfg(windows)]
const LOCKFILE_EXCLUSIVE_LOCK: u32 = 0x2;
#[cfg(windows)]
const LOCKFILE_RELEASE: u32 = 0x8000_0000;
#[cfg(windows)]
const MAXDWORD: u32 = 0xFFFF_FFFF;

#[cfg(windows)]
#[repr(C)]
struct Overlapped {
    internal: usize,
    internal_high: usize,
    offset: u32,
    offset_high: u32,
    h_event: RawHandle,
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn LockFileEx(
        h_file: RawHandle,
        flags: u32,
        reserved: u32,
        bytes_low: u32,
        bytes_high: u32,
        overlapped: *mut Overlapped,
    ) -> i32;
}

#[cfg(unix)]
#[link(name = "c")]
extern "C" {
    fn flock(fd: i32, operation: i32) -> i32;
}

#[cfg(unix)]
const LOCK_EX: i32 = 2;
#[cfg(unix)]
const LOCK_NB: i32 = 4;
#[cfg(unix)]
const LOCK_UN: i32 = 8;

/// 尝试获取锁，失败时立即返回 false（不含等待）。
fn try_lock_once(file: &File) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        unsafe {
            let handle = file.as_raw_handle();
            let mut overlapped: Overlapped = std::mem::zeroed();
            LockFileEx(
                handle as RawHandle,
                LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
                0,
                MAXDWORD,
                MAXDWORD,
                &mut overlapped,
            ) != 0
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::io::AsRawFd;
        unsafe { flock(file.as_raw_fd(), LOCK_EX | LOCK_NB) == 0 }
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = file;
        true
    }
}

/// 锁文件路径。放在数据根目录下，文件名以点开头（Unix 下不干扰 ls）。
pub fn lock_path(root: &Path) -> PathBuf {
    root.join(".workbench.lock")
}

/// 在超时内获取排他锁。超时返回可读错误，而不是无限等待。
pub fn acquire(root: &Path) -> Result<CrossProcessLock, String> {
    acquire_with_timeout(root, DEFAULT_TIMEOUT)
}

pub fn acquire_with_timeout(
    root: &Path,
    timeout: Duration,
) -> Result<CrossProcessLock, String> {
    std::fs::create_dir_all(root)
        .map_err(|e| format!("无法创建数据目录 {}: {e}", root.display()))?;
    let path = lock_path(root);
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(&path)
        .map_err(|e| format!("无法打开数据锁文件 {}: {e}", path.display()))?;

    let started = Instant::now();
    loop {
        if try_lock_once(&file) {
            return Ok(CrossProcessLock { file, path });
        }
        if started.elapsed() >= timeout {
            return Err(format!(
                "另一个 Workbench 进程正在写入数据（等待 {} 秒后放弃）；\
                 请稍后重试，或先关闭另一个实例",
                timeout.as_secs()
            ));
        }
        std::thread::sleep(RETRY_INTERVAL);
    }
}

/// 在跨进程锁内执行一段可能写盘的逻辑。
pub fn with_lock<T>(
    root: &Path,
    f: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _guard = acquire(root)?;
    f()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "wb-lock-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn same_process_second_acquire_times_out() {
        let root = tmp_root("same");
        let first = acquire(&root).expect("first lock");
        // 同一进程、不同文件句柄：Windows 的 LockFileEx 与 Unix 的 flock
        // 都按「句柄」判定，因此这里必须拿不到锁。
        let second = acquire_with_timeout(&root, Duration::from_millis(150));
        assert!(second.is_err(), "second acquire should time out");
        drop(first);
        // 释放后应能立刻再拿到
        assert!(acquire_with_timeout(&root, Duration::from_secs(2)).is_ok());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn with_lock_releases_on_error() {
        let root = tmp_root("err");
        let r: Result<(), String> = with_lock(&root, || Err("boom".into()));
        assert!(r.is_err());
        // 出错路径也必须释放锁
        assert!(acquire_with_timeout(&root, Duration::from_secs(2)).is_ok());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn lock_file_path_is_stable_and_hidden() {
        let p = lock_path(Path::new("/tmp/wb"));
        assert_eq!(p.file_name().unwrap(), ".workbench.lock");
    }
}
