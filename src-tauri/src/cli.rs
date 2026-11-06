//! 无界面模式：同一个可执行文件既是桌面应用，也是命令行工具。
//!
//! 为什么需要它：这台机器上有大量「一次性看一眼」的需求——端口被谁占了、
//! 哪个进程在烧 CPU、成本库现在多少条。为这些打开一个 1440×900 的窗口是浪费。
//! 竞品里 ccusage（`--json`）和 Glances（REST）都把「可被脚本消费」当作一等能力，
//! 这里先补最小的一层：`ps` / `ports` / `diag`，都支持 `--json`。
//!
//! 设计边界：CLI **只读**。不提供 kill / 改配置，避免把不可逆操作藏进脚本里；
//! 需要写入的路径继续走桌面 UI 的确认流程。

use crate::diagnostics;
use crate::ports;
use crate::procs;
use serde_json::json;

const HELP: &str = "\
workbench — local-first desktop workbench

USAGE:
    workbench <command> [options]

COMMANDS:
    ps              List every process (pid, name, cpu%, memory, parent, status)
    ports           List listening TCP/UDP ports with the owning PID
    diag            Environment self-check (platform, data dir, session folders, port tools)
    cost            AI session cost summary (--json, --days N, --by-project)
    serve [opts]    Run the headless HTTP server + web UI (see below)
    --version       Print the version
    --help          Print this help

OPTIONS:
    --json          Machine-readable output (one JSON document on stdout)

SERVE OPTIONS:
    --port <n>      TCP port to listen on (default 7788; 0 = pick a free port)
    --host <addr>   Bind address (default 127.0.0.1; only loopback is sensible)
    --dist <dir>    Frontend build output to serve (default: auto-detect dist/)
    --allow-origin <url>  Allow one cross-origin client (e.g. http://localhost:5173)
    --data-dir <dir>      Override the data directory (same as WORKBENCH_DATA_DIR)

NOTES:
    With no arguments the desktop app starts as usual.
    The CLI is read-only for machine state: killing processes stays in the GUI.
    `serve` exposes the same read paths plus project/task and cost-settings writes.
";

fn data_dir() -> std::path::PathBuf {
    crate::paths::DataRoot::resolve()
        .map(|r| r.as_path().to_path_buf())
        .unwrap_or_else(|_| std::env::temp_dir().join(crate::paths::APP_IDENTIFIER))
}

/// 解析 `serve` 的参数。失败时返回可读错误，由调用方打印并以非 0 退出。
fn parse_serve_args(args: &[String]) -> Result<crate::server::ServeOptions, String> {
    let mut port: u16 = 7788;
    let mut host = "127.0.0.1".to_string();
    let mut dist: Option<std::path::PathBuf> = None;
    let mut allow_origin: Option<String> = None;
    let mut data_override: Option<std::path::PathBuf> = None;

    let mut i = 1; // args[0] 是 "serve"
    while i < args.len() {
        let flag = args[i].clone();
        let value = |i: usize| -> Result<String, String> {
            args.get(i + 1)
                .cloned()
                .ok_or_else(|| format!("{flag} 缺少取值"))
        };
        match flag.as_str() {
            "--port" | "-p" => {
                let raw = value(i)?;
                port = raw
                    .parse::<u16>()
                    .map_err(|e| format!("--port 不是合法端口 {raw}: {e}"))?;
                i += 2;
            }
            "--host" => {
                host = value(i)?;
                i += 2;
            }
            "--dist" => {
                dist = Some(std::path::PathBuf::from(value(i)?));
                i += 2;
            }
            "--allow-origin" => {
                allow_origin = Some(value(i)?);
                i += 2;
            }
            "--data-dir" => {
                data_override = Some(std::path::PathBuf::from(value(i)?));
                i += 2;
            }
            other => return Err(format!("serve 不认识的参数: {other}")),
        }
    }

    let root = match data_override {
        Some(dir) => crate::paths::DataRoot::new(dir).ensure()?.clone(),
        None => crate::paths::DataRoot::resolve()?.ensure()?.clone(),
    };
    let addr = crate::server::parse_addr(&host, port)?;
    let mut opts = crate::server::ServeOptions::new(addr, root);
    opts.static_dir = crate::server::resolve_static_dir(dist.as_deref());
    opts.allow_origin = allow_origin;
    Ok(opts)
}

/// 写 stdout。
///
/// Windows 上主程序是 `windows_subsystem = "windows"`，双击启动时没有控制台；
/// 从终端启动时父进程有控制台但本进程没附着到它，`println!` 会被丢弃。
/// 三种情况都要正确写出，否则 `--version > out.txt` 会得到空文件：
/// 1) 输出被重定向到文件 / 管道 —— 标准句柄有效，直接写；
/// 2) 从 cmd / PowerShell 启动 —— 附着父控制台后写 `CONOUT$`；
/// 3) mintty 等无控制台环境 —— 没有句柄可写，放弃（进程仍以正确码退出）。
fn emit(text: &str) {
    #[cfg(windows)]
    {
        use std::io::Write;
        extern "system" {
            fn GetStdHandle(n_std_handle: u32) -> *mut core::ffi::c_void;
            fn GetFileType(h_file: *mut core::ffi::c_void) -> u32;
            fn AttachConsole(dw_process_id: u32) -> i32;
        }
        const STD_OUTPUT_HANDLE: u32 = 0xFFFF_FFF5;
        const ATTACH_PARENT_PROCESS: u32 = 0xFFFF_FFFF;
        const FILE_TYPE_UNKNOWN: u32 = 0;
        const INVALID_HANDLE_VALUE: isize = -1;

        let handle = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) };
        let valid = !handle.is_null()
            && handle as isize != INVALID_HANDLE_VALUE
            && unsafe { GetFileType(handle) } != FILE_TYPE_UNKNOWN;
        if valid {
            let mut out = std::io::stdout();
            let _ = out.write_all(text.as_bytes());
            let _ = out.write_all(
                b"
",
            );
            let _ = out.flush();
            return;
        }
        unsafe {
            AttachConsole(ATTACH_PARENT_PROCESS);
        }
        if let Ok(mut con) = std::fs::OpenOptions::new().write(true).open("CONOUT$") {
            let _ = con.write_all(text.as_bytes());
            let _ = con.write_all(
                b"
",
            );
            return;
        }
    }
    println!("{text}");
}

fn ps_text(rows: &[procs::ProcInfo]) -> String {
    let mut out = format!(
        "{:>7}  {:<24} {:>7} {:>10}  {:<10} {}\n",
        "PID", "NAME", "CPU%", "MEM", "STATUS", "COMMAND"
    );
    for p in rows {
        let cmd = if p.cmd_line.is_empty() {
            p.exe_path.clone()
        } else {
            p.cmd_line.clone()
        };
        let cmd = if cmd.chars().count() > 70 {
            let tail: String = cmd
                .chars()
                .rev()
                .take(67)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            format!("...{tail}")
        } else {
            cmd
        };
        out.push_str(&format!(
            "{:>7}  {:<24} {:>7.1} {:>10}  {:<10} {}\n",
            p.pid,
            truncate(&p.name, 24),
            p.cpu,
            p.memory,
            truncate(&p.status, 10),
            cmd
        ));
    }
    out.trim_end().to_string()
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        return s.to_string();
    }
    let head: String = s.chars().take(n.saturating_sub(1)).collect();
    format!("{head}…")
}

fn ports_text(rows: &[ports::PortEntry]) -> String {
    let mut out = format!(
        "{:<5} {:>6} {:<24} {:<12} {}\n",
        "PROTO", "PORT", "ADDRESS", "STATE", "PID"
    );
    for p in rows {
        out.push_str(&format!(
            "{:<5} {:>6} {:<24} {:<12} {}\n",
            p.protocol, p.local_port, p.local_addr, p.state, p.pid
        ));
    }
    out.trim_end().to_string()
}

fn diag_text(report: &diagnostics::DiagnosticsReport) -> String {
    let mut out = format!(
        "workbench {} · {}\n{}\n\n",
        report.app_version, report.platform, report.data_dir
    );
    for c in &report.checks {
        out.push_str(&format!(
            "[{:<4}] {:<22} {}{}\n",
            c.level.to_uppercase(),
            c.id,
            c.detail,
            if c.hint.is_empty() {
                String::new()
            } else {
                format!("  → {}", c.hint)
            }
        ));
    }
    out.push_str(&format!(
        "\n{} ok · {} warn · {} fail",
        report.ok_count, report.warn_count, report.fail_count
    ));
    out
}

/// 成本摘要的文本输出。数字右对齐、金额固定两位小数，便于在终端里竖着比对。
fn cost_text(
    overview: &crate::cost_store::CostOverview,
    trend: &[crate::cost_store::CostTrendRow],
    projects: &[crate::cost_store::ProjectBreakdownRow],
    days: usize,
) -> String {
    let mut out = format!(
        "Workbench cost ledger ({days}d window)

         TODAY    ${:>9.2}  {:>10} in  {:>10} out  {:>10} cache-r  {:>10} cache-w
         MONTH    ${:>9.2}  {:>10} in  {:>10} out
         TOTAL    ${:>9.2}  {} records ({} measured / {} estimated / {} unpriced)
",
        overview.today_cost,
        overview.today_input_tokens,
        overview.today_output_tokens,
        overview.today_cache_read_tokens,
        overview.today_cache_creation_tokens,
        overview.month_cost,
        overview.month_input_tokens,
        overview.month_output_tokens,
        overview.total_cost,
        overview.record_count,
        overview.measured_count,
        overview.estimated_count,
        overview.zero_pricing_count,
    );

    if !trend.is_empty() {
        out.push_str("
BY DAY
");
        for row in trend {
            out.push_str(&format!(
                "  {}  ${:>8.2}  {:>3} rec
",
                row.day, row.cost, row.record_count
            ));
        }
    }

    if !projects.is_empty() {
        out.push_str("
BY PROJECT
");
        for row in projects.iter().take(20) {
            let label = if row.project.is_empty() {
                "(unattributed)"
            } else {
                row.project.as_str()
            };
            out.push_str(&format!("  ${:>8.2}  {}
", row.cost, label));
        }
    }

    out.push_str(&format!(
        "
Budget: daily ${:.2} ({:.0}%)  monthly ${:.2} ({:.0}%){}
",
        overview.daily_budget,
        overview.daily_pct,
        overview.monthly_budget,
        overview.monthly_pct,
        if overview.budget_exceeded {
            "  [OVER BUDGET]"
        } else {
            ""
        }
    ));
    out.trim_end().to_string()
}

/// `cost` 子命令：只读聚合，不做扫描（扫描需写库，交给桌面端或 `serve`）。
fn run_cost(args: &[String]) -> i32 {
    let json_out = args.iter().any(|a| a == "--json");
    let mut days: usize = 14;
    let mut by_project = false;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--json" => i += 1,
            "--by-project" => {
                by_project = true;
                i += 1;
            }
            "--days" => {
                match args.get(i + 1).and_then(|v| v.parse::<usize>().ok()) {
                    Some(v) => days = v.clamp(1, 3650),
                    None => {
                        emit("--days 需要一个正整数");
                        return 2;
                    }
                }
                i += 2;
            }
            other => {
                emit(&format!("cost 不认识的参数: {other}"));
                return 2;
            }
        }
    }

    let root = match crate::paths::DataRoot::resolve() {
        Ok(r) => r,
        Err(e) => {
            emit(&format!("无法定位数据目录: {e}"));
            return 1;
        }
    };

    let overview = match crate::cost_store::build_overview(&root) {
        Ok(v) => v,
        Err(e) => {
            emit(&format!("读取成本总览失败: {e}"));
            return 1;
        }
    };
    let trend = crate::cost_store::build_trend(&root, days).unwrap_or_default();
    let projects = if by_project {
        crate::cost_store::build_project_breakdown(&root).unwrap_or_default()
    } else {
        Vec::new()
    };

    if json_out {
        // 稳定契约：顶层带 schema/generated_at，脚本可据此判断兼容性。
        let payload = json!({
            "schema": 1,
            "generated_at": chrono::Local::now().to_rfc3339(),
            "days": days,
            "overview": overview,
            "trend": trend,
            "projects": projects,
        });
        emit(&serde_json::to_string_pretty(&payload)
            .unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}")));
    } else {
        emit(&cost_text(&overview, &trend, &projects, days));
    }
    0
}

/// 解析参数并执行。返回 `None` 表示「不是 CLI 调用，应该启动桌面窗口」。
pub fn try_run() -> Option<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        return None;
    }
    let cmd = args[0].as_str();
    // Tauri 自身会带参数启动（如 --tauri-...），不能被当成未知命令。
    if cmd.starts_with("--tauri") || cmd.starts_with("tauri://") {
        return None;
    }
    let json_out = args.iter().any(|a| a == "--json");
    let text = match cmd {
        "-V" | "--version" => format!("workbench {}", env!("CARGO_PKG_VERSION")),
        "-h" | "--help" | "help" => HELP.trim_end().to_string(),
        "ps" => {
            let rows = procs::snapshot_processes();
            if json_out {
                serde_json::to_string_pretty(&rows)
                    .unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"))
            } else {
                ps_text(&rows)
            }
        }
        "ports" => match ports::collect() {
            Ok(rows) => {
                if json_out {
                    serde_json::to_string_pretty(&rows)
                        .unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"))
                } else {
                    ports_text(&rows)
                }
            }
            Err(e) => {
                if json_out {
                    json!({ "error": e }).to_string()
                } else {
                    format!("端口采集失败: {e}")
                }
            }
        },
        "cost" => return Some(run_cost(&args)),
        "diag" => {
            let report = diagnostics::collect(env!("CARGO_PKG_VERSION"), &data_dir());
            if json_out {
                serde_json::to_string_pretty(&report)
                    .unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"))
            } else {
                diag_text(&report)
            }
        }
        // `serve` 不走文本输出路径：它是长期运行的服务，自己负责打印与退出码。
        "serve" => {
            let opts = match parse_serve_args(&args) {
                Ok(o) => o,
                Err(e) => {
                    emit(&format!("{e}\n\n{HELP}"));
                    return Some(2);
                }
            };
            let runtime = match tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    emit(&format!("创建运行时失败: {e}"));
                    return Some(1);
                }
            };
            return Some(match runtime.block_on(crate::server::serve(opts)) {
                Ok(()) => 0,
                Err(e) => {
                    emit(&format!("服务启动失败: {e}"));
                    1
                }
            });
        }
        other => {
            let msg = format!("未知命令: {other}\n\n{HELP}");
            emit(&msg);
            return Some(2);
        }
    };
    emit(&text);
    Some(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn help_lists_every_command() {
        for cmd in ["ps", "ports", "diag", "cost", "serve", "--version", "--json"] {
            assert!(HELP.contains(cmd), "help 缺少 {cmd}");
        }
    }

    #[test]
    fn cost_text_marks_over_budget() {
        use crate::cost_store::{CostOverview, CostTrendRow};
        let overview = CostOverview {
            today_cost: 1.5,
            today_input_tokens: 100,
            today_output_tokens: 50,
            today_cache_read_tokens: 0,
            today_cache_creation_tokens: 0,
            month_cost: 12.0,
            month_input_tokens: 1000,
            month_output_tokens: 500,
            month_cache_read_tokens: 0,
            month_cache_creation_tokens: 0,
            total_cost: 42.0,
            total_input_tokens: 5000,
            total_output_tokens: 2000,
            total_cache_read_tokens: 0,
            total_cache_creation_tokens: 0,
            record_count: 7,
            measured_count: 5,
            estimated_count: 1,
            zero_pricing_count: 1,
            daily_budget: 1.0,
            monthly_budget: 100.0,
            alert_threshold_pct: 80,
            daily_pct: 150.0,
            monthly_pct: 12.0,
            budget_exceeded: true,
        };
        let trend = vec![CostTrendRow {
            day: "2026-11-06".into(),
            input_tokens: 100,
            output_tokens: 50,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            cost: 1.5,
            record_count: 3,
        }];
        let text = cost_text(&overview, &trend, &[], 14);
        assert!(text.contains("OVER BUDGET"), "超预算必须显式标注");
        assert!(text.contains("2026-11-06"));
        // 三个来源计数都要出现：只报总量会掩盖「多少是猜的」
        assert!(text.contains("5 measured"));
        assert!(text.contains("1 estimated"));
        assert!(text.contains("1 unpriced"));
    }

    #[test]
    fn truncate_keeps_width_and_marks_cut() {
        assert_eq!(truncate("node", 10), "node");
        let cut = truncate("a-very-long-process-name", 8);
        assert_eq!(cut.chars().count(), 8);
        assert!(cut.ends_with('…'));
    }

    #[test]
    fn data_dir_honours_override() {
        std::env::set_var("WORKBENCH_DATA_DIR", "/tmp/wb-cli-test");
        assert_eq!(data_dir(), std::path::PathBuf::from("/tmp/wb-cli-test"));
        std::env::remove_var("WORKBENCH_DATA_DIR");
    }

    #[test]
    fn ps_text_has_a_header_and_one_line_per_row() {
        use crate::procs::ProcInfo;
        let row = ProcInfo {
            pid: 42,
            name: "demo".into(),
            exe_path: "/bin/demo".into(),
            cmd_line: "demo --flag".into(),
            argv: vec!["demo".into()],
            cwd: "/".into(),
            cpu: 1.5,
            memory: 1024,
            parent_pid: None,
            status: "Run".into(),
            start_time: 0,
        };
        let text = ps_text(&[row]);
        assert!(text.lines().next().unwrap().contains("PID"));
        assert_eq!(text.lines().count(), 2);
        assert!(text.contains("demo --flag"));
    }
}
