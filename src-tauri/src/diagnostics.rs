//! 环境自检：把「这个应用为什么在这个机器上看起来不对」变成可读的证据。
//!
//! 每一项检查都独立执行、独立汇报，任何一项失败都不能让整份报告消失——
//! 用户最需要诊断的时候，恰恰是最不可能拿到完整环境的时候。

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone, Debug, ts_rs::TS)]
pub struct DiagnosticCheck {
    /// 稳定 id，前端据此选图标与文档锚点
    pub id: String,
    /// 面向用户的名称（英文；前端按 id 本地化）
    pub label: String,
    /// ok / warn / fail
    pub level: String,
    /// 一行结论
    pub detail: String,
    /// 可执行的修复建议（没有则为空）
    pub hint: String,
}

#[derive(Serialize, Clone, Debug, ts_rs::TS)]
pub struct DiagnosticsReport {
    pub platform: String,
    pub app_version: String,
    pub data_dir: String,
    pub checks: Vec<DiagnosticCheck>,
    pub ok_count: usize,
    pub warn_count: usize,
    pub fail_count: usize,
}

fn check(id: &str, label: &str, level: &str, detail: String, hint: &str) -> DiagnosticCheck {
    DiagnosticCheck {
        id: id.to_string(),
        label: label.to_string(),
        level: level.to_string(),
        detail,
        hint: hint.to_string(),
    }
}

fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

/// 会话目录：存在且有 .jsonl 才算可用。空目录是 warn 而非 ok——
/// 「装了这个工具但从未用过」和「根本没装」对成本页是同一件事。
fn session_dir_check(id: &str, label: &str, dir: Option<PathBuf>) -> DiagnosticCheck {
    let Some(dir) = dir else {
        return check(id, label, "warn", "Home directory not found".into(), "");
    };
    if !dir.is_dir() {
        return check(
            id,
            label,
            "warn",
            format!("{} does not exist", dir.display()),
            "Normal until the tool has been used at least once",
        );
    }
    let count = std::fs::read_dir(&dir)
        .map(|rd| {
            rd.flatten()
                .filter(|e| {
                    e.path()
                        .extension()
                        .map(|x| x.eq_ignore_ascii_case("jsonl"))
                        .unwrap_or(false)
                })
                .count()
        })
        .unwrap_or(0);
    if count == 0 {
        check(
            id,
            label,
            "warn",
            format!("{} has no .jsonl sessions", dir.display()),
            "Run the tool once, then rescan costs",
        )
    } else {
        check(
            id,
            label,
            "ok",
            format!("{count} session files in {}", dir.display()),
            "",
        )
    }
}

/// 端口工具探测。
///
/// 不能统一用 `--version`：Windows 自带 netstat 不支持该参数，会成功退出但
/// 输出为空，于是「工具其实可用」被报成 warn（本机实测就踩到了）。
/// 这里直接跑真实采集命令，按能否解析出条目判定——验证的是我们真正要用的能力。
fn port_tool_check(id: &str, label: &str, program: &str, hint: &str) -> DiagnosticCheck {
    let args: &[&str] = if program == "ss" {
        &["-tulpnH"]
    } else if cfg!(windows) {
        &["-ano"]
    } else {
        &["-tulpn"]
    };
    match crate::procs::run_quiet(program, args) {
        Ok(out) if !out.trim().is_empty() => check(
            id,
            label,
            "ok",
            format!("{} lines of output", out.lines().count()),
            "",
        ),
        Ok(_) => check(
            id,
            label,
            "warn",
            format!("{program} returned no output"),
            hint,
        ),
        Err(e) => check(
            id,
            label,
            "warn",
            format!("{program} not available ({e})"),
            hint,
        ),
    }
}

/// 执行全部检查。`data_dir` 由调用方从 Tauri 传入（本模块不依赖 AppHandle，
/// 便于单测在没有窗口的环境里跑）。
pub fn collect(app_version: &str, data_dir: &Path) -> DiagnosticsReport {
    let mut checks = Vec::new();

    checks.push(check(
        "platform",
        "Operating system",
        "ok",
        format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        "",
    ));

    let writable = std::fs::create_dir_all(data_dir).is_ok()
        && std::fs::write(data_dir.join(".write-probe"), b"ok")
            .map(|_| {
                let _ = std::fs::remove_file(data_dir.join(".write-probe"));
                true
            })
            .unwrap_or(false);
    checks.push(check(
        "data-dir",
        "Data directory",
        if writable { "ok" } else { "fail" },
        data_dir.display().to_string(),
        if writable {
            ""
        } else {
            "Grant write access or move the app data directory"
        },
    ));

    let db = data_dir.join("cost.db");
    checks.push(check(
        "cost-db",
        "Cost ledger (SQLite)",
        if db.is_file() { "ok" } else { "warn" },
        if db.is_file() {
            format!(
                "{} bytes",
                std::fs::metadata(&db).map(|m| m.len()).unwrap_or(0)
            )
        } else {
            "Not created yet — run a cost scan".to_string()
        },
        if db.is_file() {
            ""
        } else {
            "Open Cost ledger and press Scan"
        },
    ));

    let h = home();
    checks.push(session_dir_check(
        "claude-sessions",
        "Claude Code sessions",
        h.as_ref().map(|p| p.join(".claude").join("projects")),
    ));
    checks.push(session_dir_check(
        "codex-sessions",
        "Codex sessions",
        h.as_ref().map(|p| p.join(".codex").join("sessions")),
    ));
    checks.push(session_dir_check(
        "opencode-sessions",
        "opencode data",
        h.as_ref()
            .map(|p| p.join(".local").join("share").join("opencode")),
    ));

    // 端口采集依赖：Windows 自带 netstat；Linux 优先 ss，回退 netstat。
    #[cfg(windows)]
    checks.push(port_tool_check(
        "netstat",
        "netstat",
        "netstat",
        "Windows component; reinstall network tools if missing",
    ));
    #[cfg(target_os = "linux")]
    {
        let ss = port_tool_check("ss", "ss (iproute2)", "ss", "Install iproute2");
        let level_is_ok = ss.level == "ok";
        checks.push(ss);
        if !level_is_ok {
            checks.push(port_tool_check(
                "netstat",
                "netstat (fallback)",
                "netstat",
                "Install net-tools as a fallback",
            ));
        }
    }
    #[cfg(target_os = "macos")]
    checks.push(port_tool_check(
        "netstat",
        "netstat",
        "netstat",
        "Installed with macOS base system",
    ));

    // 托盘可用性只能在真实窗口里判断，这里只报告用户可自行验证的线索。
    #[cfg(target_os = "linux")]
    checks.push(check(
        "tray",
        "System tray",
        "warn",
        "On GNOME/Wayland the tray needs an AppIndicator extension".into(),
        "If no tray icon appears, set WORKBENCH_NO_TRAY=1 and close-to-exit is used",
    ));

    // 崩溃记录：只在真的发生过 panic 时才出现，避免给「一切正常」的用户
    // 增加一条永远 ok 的噪音条目。用户报「窗口自己没了」时，这一条就是答案。
    if let Some(crash) = crash_log_check(data_dir) {
        checks.push(crash);
    }

    let ok_count = checks.iter().filter(|c| c.level == "ok").count();
    let warn_count = checks.iter().filter(|c| c.level == "warn").count();
    let fail_count = checks.iter().filter(|c| c.level == "fail").count();

    DiagnosticsReport {
        platform: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        app_version: app_version.to_string(),
        data_dir: data_dir.display().to_string(),
        checks,
        ok_count,
        warn_count,
        fail_count,
    }
}

/// 上一次运行是否留下 panic 记录。
///
/// 桌面应用由窗口启动时没有控制台，`panic!` 的默认输出会彻底丢失；
/// 崩溃钩子把它写进 `crash.log`（见 logging_setup），这里读回来展示。
/// 只报告是否存在与最后一行摘要，不把整个堆栈塞进 UI 列表。
fn crash_log_check(data_dir: &Path) -> Option<DiagnosticCheck> {
    let candidates = [
        data_dir.join("crash.log"),
        std::env::temp_dir().join(format!("{}.crash.log", crate::paths::APP_IDENTIFIER)),
    ];
    for path in candidates {
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let tail = text.lines().rfind(|l| !l.trim().is_empty())?;
        let hint = "If the app closed unexpectedly, please attach this file to your issue";
        return Some(check(
            "crash-log",
            "Previous crash",
            "warn",
            format!("{}
{}", path.display(), tail.chars().take(200).collect::<String>()),
            hint,
        ));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_always_contains_platform_and_data_dir() {
        let dir = std::env::temp_dir().join(format!("wb-diag-{}", std::process::id()));
        let report = collect("0.0.0-test", &dir);
        assert!(report
            .checks
            .iter()
            .any(|c| c.id == "platform" && c.level == "ok"));
        assert!(report.checks.iter().any(|c| c.id == "data-dir"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn counts_match_levels() {
        let dir = std::env::temp_dir().join(format!("wb-diag2-{}", std::process::id()));
        let report = collect("0.0.0-test", &dir);
        assert_eq!(
            report.ok_count + report.warn_count + report.fail_count,
            report.checks.len()
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 回归：Windows 自带 netstat 不支持 `--version`，早期实现用统一版本探测，
    /// 结果「工具可用」被误报成 warn。这里直接验证真实端口命令能被识别为 ok。
    #[cfg(windows)]
    #[test]
    fn netstat_probe_uses_the_real_command() {
        let c = port_tool_check("netstat", "netstat", "netstat", "");
        assert_eq!(c.level, "ok", "netstat 应判定为可用，实际: {}", c.detail);
    }

    #[test]
    fn missing_session_dir_is_warn_not_fail() {
        let c = session_dir_check("x", "X", Some(PathBuf::from("/definitely/not/here")));
        assert_eq!(c.level, "warn");
    }
}

#[cfg(test)]
mod crash_tests {
    use super::*;

    /// 没有崩溃文件时不应凭空产生一条 warn——那会让「一切正常」的报告
    /// 变成永远有条黄色警告，用户很快就学会忽略整份报告。
    #[test]
    fn no_crash_file_means_no_check() {
        let dir = std::env::temp_dir().join(format!("wb-nocrash-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(crash_log_check(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 有崩溃文件时必须报出来，并带上最后一行摘要（这是用户唯一能提供的信息）。
    #[test]
    fn crash_file_is_reported_with_last_line() {
        let dir = std::env::temp_dir().join(format!("wb-crash-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("crash.log"),
            "[2026-01-01 10:00:00] [PANIC]: boom @ src/lib.rs:10:5\n\
             [2026-01-01 10:00:01] [PANIC]: second panic @ src/x.rs:1:1\n",
        )
        .unwrap();

        let found = crash_log_check(&dir).expect("should detect crash log");
        assert_eq!(found.id, "crash-log");
        assert_eq!(found.level, "warn");
        // 只带最后一条，且截断到 200 字符内
        assert!(found.detail.contains("second panic"));
        assert!(!found.detail.contains("boom"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 空文件等同于没有崩溃：不能因为文件被创建过就报警。
    #[test]
    fn empty_crash_file_is_ignored() {
        let dir = std::env::temp_dir().join(format!("wb-emptycrash-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("crash.log"), "\n\n").unwrap();
        assert!(crash_log_check(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
