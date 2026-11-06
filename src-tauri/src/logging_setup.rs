//! 日志系统：写日志到 app_data_dir/workbench.log。
//! - 运行期滚动：后台线程每分钟检查一次大小，超限就 truncate 当前文件。
//!   只在启动时检查是不够的 —— 关窗只是隐藏到托盘（lib.rs），进程极少重启，
//!   长期运行会让日志无限增长（实测 ~9KB/h，一年 27MB）。
//! - 读取采用尾部倒读（tail），日志再大也只按需读取最后几块，避免整文件载入。
use chrono::Local;
use log::LevelFilter;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
const TAIL_CHUNK: u64 = 64 * 1024;
/// 运行期检查间隔：日志增长很慢，一分钟一次足够，开销可忽略。
const ROTATE_CHECK_INTERVAL: std::time::Duration = std::time::Duration::from_secs(60);

/// 安装 panic 钩子：把崩溃写进同一个日志文件。
///
/// 为什么必须做：Rust 侧 panic 默认只打到 stderr。桌面应用由窗口启动时
/// 没有控制台，`panic!` 的整段信息（消息 + 位置 + backtrace）会彻底丢失，
/// 用户看到的是「窗口没了」，维护者拿到的是零线索。日志文件是唯一能跨
/// 重启留存的地方，所以先装钩子再初始化 logger —— 顺序反了的话，
/// 早期 panic 仍然写不进去。
///
/// 钩子内**只写文件**，不再调用 log 宏：logger 可能在 panic 时正持有锁，
/// 二次进入会死锁，反而吞掉真正的崩溃信息。
pub fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // 保留默认行为（stderr / backtrace 环境变量），再补一份到日志文件。
        default_hook(info);

        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "<non-string panic payload>".to_string());
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "<unknown location>".to_string());

        let line = format!(
            "[{}] [PANIC]: {payload} @ {location}
",
            Local::now().format("%Y-%m-%d %H:%M:%S")
        );
        // 追加写入：不依赖 logger 状态，也不做轮转（崩溃是低频事件）。
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(panic_log_path())
        {
            use std::io::Write;
            let _ = f.write_all(line.as_bytes());
            let _ = f.flush();
        }
    }));
}

/// panic 日志路径。与 `workbench.log` 同目录，但独立文件：
/// 崩溃信息不能被日志轮转截断，也不该混进常规运行日志里被淹没。
fn panic_log_path() -> PathBuf {
    if let Some(v) = std::env::var_os("WORKBENCH_DATA_DIR") {
        if !v.is_empty() {
            let dir = PathBuf::from(v);
            let _ = std::fs::create_dir_all(&dir);
            return dir.join("crash.log");
        }
    }
    // 无环境变量时退到临时目录：panic 可能发生在 Tauri 完成路径解析之前，
    // 此时用 app_data_dir 拿不到值，而写临时目录总比丢失强。
    std::env::temp_dir().join(format!("{}.crash.log", crate::paths::APP_IDENTIFIER))
}

pub fn init_logging(app: &AppHandle) {
    let log_path = match log_file_path(app) {
        Some(p) => p,
        None => return,
    };
    prune_if_needed(&log_path);

    // release 默认 Info：此前 Debug 恒定开启，一次 UI 刷新会打两条
    // 「list_processes 返回 N 条」，日志里 70% 是这种噪音。
    let level = if cfg!(debug_assertions) {
        LevelFilter::Debug
    } else {
        LevelFilter::Info
    };

    let dispatch = fern::Dispatch::new()
        .format(|out, message, record| {
            out.finish(format_args!(
                "[{}] [{}]: {}",
                Local::now().format("%Y-%m-%d %H:%M:%S"),
                record.level(),
                message
            ))
        })
        .level(level);

    // 日志文件不可写（目录权限、被杀软占用、磁盘满）时降级到控制台，
    // 绝不因为「日志写不了」而让整个应用启动失败。
    let dispatch = match fern::log_file(&log_path) {
        Ok(sink) => dispatch.chain(sink),
        Err(e) => {
            eprintln!(
                "日志文件不可用，降级为控制台输出 {}: {e}",
                log_path.display()
            );
            dispatch.chain(std::io::stderr())
        }
    };

    if dispatch.apply().is_err() {
        eprintln!("日志子系统安装失败");
    }

    spawn_rotator(log_path);
}

/// 后台轮转线程：超过上限就截断。用截断而不是 rename，是因为 fern 持有
/// 的是已打开的 File 句柄 —— rename 在 Windows 上会因文件被占用失败，
/// 而截断同一句柄下的文件内容是合法且原子的（写入位置随之回到 0）。
fn spawn_rotator(path: PathBuf) {
    std::thread::Builder::new()
        .name("log-rotator".to_string())
        .spawn(move || loop {
            std::thread::sleep(ROTATE_CHECK_INTERVAL);
            prune_if_needed(&path);
        })
        .ok();
}

/// 超过上限就把日志截断为空文件（保留文件本身，句柄继续有效）。
fn prune_if_needed(path: &Path) {
    let Ok(meta) = fs::metadata(path) else {
        return;
    };
    if meta.len() <= MAX_LOG_BYTES {
        return;
    }
    if let Ok(f) = fs::OpenOptions::new().write(true).open(path) {
        if f.set_len(0).is_ok() {
            log::warn!("日志超过 {} 字节，已截断", MAX_LOG_BYTES);
        }
    }
}

fn log_file_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("workbench.log"))
}

/// 读取最近 max_lines 行日志（尾部倒读，前端调用）。
pub fn read_recent_logs(app: &AppHandle, max_lines: usize) -> String {
    let path = match log_file_path(app) {
        Some(p) => p,
        None => return String::new(),
    };
    read_tail(&path, max_lines)
}

/// 尾部倒读实现。抽成纯函数以便单测。
///
/// 注意块边界：按字节分块读取会把多字节 UTF-8 字符切断在块边界
/// （中文日志很常见），`from_utf8_lossy` 会在切断处产生 U+FFFD 替换字符。
/// 这里先把整段 bytes 拼好、再按「最后一个完整行」裁掉可能残缺的首行。
fn read_tail(path: &Path, max_lines: usize) -> String {
    if max_lines == 0 {
        return String::new();
    }
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return String::new(),
    };
    let len = match file.metadata() {
        Ok(m) => m.len(),
        Err(_) => return String::new(),
    };
    if len == 0 {
        return String::new();
    }

    // 从文件尾向前按块读取，直到凑够 max_lines+1 个换行或到文件头
    let mut chunks: Vec<Vec<u8>> = Vec::new();
    let mut pos = len;
    let mut newlines = 0usize;
    while pos > 0 && newlines <= max_lines {
        let take = TAIL_CHUNK.min(pos);
        pos -= take;
        let mut buf = vec![0u8; take as usize];
        if file.seek(SeekFrom::Start(pos)).is_err() || file.read_exact(&mut buf).is_err() {
            break;
        }
        newlines += buf.iter().filter(|b| **b == b'\n').count();
        chunks.push(buf);
    }
    chunks.reverse(); // 恢复文件顺序
    let mut bytes: Vec<u8> = chunks.concat();

    // 未读到文件头时，首行可能是被块边界切断的半行：
    // 找到第一个换行并丢弃它之前的内容，避免输出残缺行。
    if pos > 0 {
        if let Some(idx) = bytes.iter().position(|b| *b == b'\n') {
            bytes.drain(..=idx);
        } else {
            // 整段没有换行说明还在一行中间，无法安全截取
            return String::new();
        }
    }

    let text = String::from_utf8_lossy(&bytes);
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    lines[start..].join("\n")
}

/// 清空日志文件。
pub fn clear_logs(app: &AppHandle) -> Result<(), String> {
    let path = log_file_path(app).ok_or("无法定位日志路径")?;
    fs::write(&path, "").map_err(|e| format!("清空日志失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_log(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("wb-log-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    #[test]
    fn reads_last_n_lines() {
        let path = tmp_log("tail-basic.log");
        let content: String = (0..100).map(|i| format!("line-{i}\n")).collect();
        fs::write(&path, content).unwrap();
        let out = read_tail(&path, 5);
        assert_eq!(out, "line-95\nline-96\nline-97\nline-98\nline-99");
        fs::remove_file(&path).ok();
    }

    #[test]
    fn missing_or_empty_file_returns_empty() {
        assert_eq!(read_tail(Path::new("C:/definitely/absent.log"), 10), "");
        let path = tmp_log("tail-empty.log");
        fs::write(&path, "").unwrap();
        assert_eq!(read_tail(&path, 10), "");
        fs::remove_file(&path).ok();
    }

    #[test]
    fn max_lines_zero_returns_empty() {
        let path = tmp_log("tail-zero.log");
        fs::write(&path, "a\nb\n").unwrap();
        assert_eq!(read_tail(&path, 0), "");
        fs::remove_file(&path).ok();
    }

    /// 回归：按字节块倒读会切断多字节 UTF-8 字符，产生 U+FFFD 替换字符。
    /// 中文日志里这会把行首/行尾变成「�」，读起来像乱码。
    #[test]
    fn chunk_boundary_does_not_corrupt_multibyte_chars() {
        let path = tmp_log("tail-utf8.log");
        // 每行都含中文；总量远超一个块，确保跨越块边界
        let mut content = String::new();
        for i in 0..5000 {
            content.push_str(&format!("[2026-01-01 00:00:00] [INFO]: 中文日志第{i}行\n"));
        }
        fs::write(&path, &content).unwrap();

        let out = read_tail(&path, 20);
        assert!(
            !out.contains('\u{FFFD}'),
            "尾部读取不应产生替换字符，got: {out}"
        );
        assert!(
            out.lines().all(|l| l.starts_with("[2026-01-01")),
            "每行都应是完整行"
        );
        assert_eq!(out.lines().count(), 20);
        fs::remove_file(&path).ok();
    }

    #[test]
    fn prune_truncates_oversized_log() {
        let path = tmp_log("prune.log");
        // 造一个超过上限的文件
        let big = vec![b'x'; (MAX_LOG_BYTES + 1024) as usize];
        fs::write(&path, &big).unwrap();
        assert!(fs::metadata(&path).unwrap().len() > MAX_LOG_BYTES);

        prune_if_needed(&path);
        assert_eq!(fs::metadata(&path).unwrap().len(), 0, "超限日志应被截断");

        // 未超限的文件不动
        fs::write(&path, "small\n").unwrap();
        prune_if_needed(&path);
        assert_eq!(fs::metadata(&path).unwrap().len(), 6);
        fs::remove_file(&path).ok();
    }
}
