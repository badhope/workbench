//! 进程快照：sysinfo 双次采样拿 CPU%，阻塞调用放在 spawn_blocking 里，不卡 UI 线程。

use serde::Serialize;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use sysinfo::{Pid, ProcessesToUpdate, System};

/// 静默执行一个外部命令并取 stdout（跨平台）。
///
/// Windows 上必须带 CREATE_NO_WINDOW：GUI 程序派生控制台子进程会闪黑窗，
/// 而端口采样是周期性的，闪窗会非常明显。
///
/// 有超时：netstat/ss 挂起时，`output()` 会永久阻塞。端口采样是在全局锁里
/// 调用的，一旦卡死，端口页、开发服务器、HTTP 端点全部排队等它。
/// 超时后杀掉子进程并返回错误，让上层退化成「本次采样失败」而不是「应用死了」。
pub fn run_quiet(program: &str, args: &[&str]) -> std::io::Result<String> {
    run_quiet_with_timeout(program, args, Duration::from_secs(15))
}

pub fn run_quiet_with_timeout(
    program: &str,
    args: &[&str],
    timeout: Duration,
) -> std::io::Result<String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::null());
    let mut child = cmd.spawn()?;
    // 必须并发读 stdout：管道容量有限（Windows 约 64KB），只等进程退出而
    // 不读管道时，子进程会写满缓冲区后阻塞，永远不退出 —— 于是超时逻辑
    // 反而把正常的大输出（netstat 几千行）误判成挂起。
    let stdout = child.stdout.take();
    let reader = std::thread::spawn(move || {
        use std::io::Read;
        let mut buf = Vec::new();
        if let Some(mut out) = stdout {
            let _ = out.read_to_end(&mut buf);
        }
        buf
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait()? {
            Some(status) => break status,
            None if started.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    format!("{} 超过 {} 秒未返回", program, timeout.as_secs()),
                ));
            }
            None => std::thread::sleep(Duration::from_millis(20)),
        }
    };
    let buf = reader.join().unwrap_or_default();
    if !status.success() {
        // 退出码非零且没有输出，多半是命令不存在或权限不足；
        // 返回错误而不是空字符串，避免上层把「失败」当成「没有端口」。
        return Err(std::io::Error::other(format!(
            "{} 退出码 {:?}",
            program,
            status.code()
        )));
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// 一次前端刷新会并发请求「进程 / 端口 / 开发服务器 / AI 进程」四个命令，
/// 每个都要一份进程快照。原先各自 `System::new_all()` + 220ms 双采样，
/// 同一时刻就是四次全量进程树扫描（CPU 开销 ×4，且四次结果可能互相错位）。
/// 这里做短 TTL 复用：同一刷新周期内共享同一份快照。
const SNAPSHOT_TTL: Duration = Duration::from_millis(400);

struct SnapshotCache {
    taken_at: Option<Instant>,
    procs: Vec<ProcInfo>,
}

static SNAPSHOT: Mutex<SnapshotCache> = Mutex::new(SnapshotCache {
    taken_at: None,
    procs: Vec::new(),
});

#[derive(Serialize, Clone, Debug, ts_rs::TS)]
pub struct ProcInfo {
    pub pid: u32,
    pub name: String,
    pub exe_path: String,
    pub cmd_line: String,
    /// 结构化 argv（与 cmd_line 同源，但不做 join/split，保留含空格的参数）
    pub argv: Vec<String>,
    /// 进程工作目录（取不到时为空串）
    pub cwd: String,
    pub cpu: f32,
    #[ts(type = "number")]
    pub memory: u64,
    pub parent_pid: Option<u32>,
    pub status: String,
    #[ts(type = "number")]
    pub start_time: u64,
}

/// 把 sysinfo 的 ProcessStatus 枚举映射成**与语言无关**的稳定键。
///
/// 这里曾经直接发中文标签，于是英文/日文界面的进程状态列永远是中文——
/// 状态是系统词汇，不能跟着后端源码的语言走。前端 `lib/processStatus.ts`
/// 负责把键翻成当前语言。
fn status_key(status: &sysinfo::ProcessStatus) -> &'static str {
    match status {
        sysinfo::ProcessStatus::Run => "Run",
        sysinfo::ProcessStatus::Sleep => "Sleep",
        sysinfo::ProcessStatus::Idle => "Idle",
        sysinfo::ProcessStatus::Stop => "Stop",
        sysinfo::ProcessStatus::Zombie => "Zombie",
        sysinfo::ProcessStatus::Dead => "Dead",
        sysinfo::ProcessStatus::Tracing => "Tracing",
        sysinfo::ProcessStatus::Wakekill => "Wakekill",
        sysinfo::ProcessStatus::Waking => "Waking",
        sysinfo::ProcessStatus::Parked => "Parked",
        sysinfo::ProcessStatus::LockBlocked => "LockBlocked",
        sysinfo::ProcessStatus::UninterruptibleDiskSleep => "UninterruptibleDiskSleep",
        _ => "Unknown",
    }
}

/// 阻塞式进程快照（含 CPU 两次刷新，约 220ms）。
/// 结果在 `SNAPSHOT_TTL` 内复用，避免一次刷新内四次全量扫描。
pub fn snapshot_processes() -> Vec<ProcInfo> {
    let mut cache = SNAPSHOT
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(taken_at) = cache.taken_at {
        if taken_at.elapsed() < SNAPSHOT_TTL {
            return cache.procs.clone();
        }
    }
    // 持锁采样：并发调用者会排队复用同一份结果，不会各自再扫一遍
    let procs = collect_processes();
    cache.procs = procs.clone();
    cache.taken_at = Some(Instant::now());
    procs
}

/// 强制重新采样（终止进程后需要立刻看到真实结果，不能读 400ms 内的旧快照）。
pub fn snapshot_processes_fresh() -> Vec<ProcInfo> {
    let mut cache = SNAPSHOT
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let procs = collect_processes();
    cache.procs = procs.clone();
    cache.taken_at = Some(Instant::now());
    procs
}

fn collect_processes() -> Vec<ProcInfo> {
    let mut sys = System::new_all();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    sys.refresh_processes(ProcessesToUpdate::All, true);

    sys.processes()
        .values()
        .map(|p| ProcInfo {
            pid: p.pid().as_u32(),
            name: p.name().to_string_lossy().to_string(),
            exe_path: p
                .exe()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
            cmd_line: p
                .cmd()
                .iter()
                .map(|s| s.to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join(" "),
            // 结构化 argv：项目目录推断不能靠「把 cmd_line 按空格重新切开」，
            // 含空格的路径会被切碎，推出一个不存在的相对目录。
            argv: p
                .cmd()
                .iter()
                .map(|s| s.to_string_lossy().to_string())
                .collect(),
            // 进程工作目录：非 Node 项目（uvicorn / go run / dotnet run）
            // 的命令行里没有 node_modules，只能靠 cwd 推断项目根。
            cwd: p
                .cwd()
                .map(|d| d.to_string_lossy().to_string())
                .unwrap_or_default(),
            cpu: p.cpu_usage(),
            memory: p.memory(),
            parent_pid: p.parent().map(|pid| pid.as_u32()),
            status: status_key(&p.status()).to_string(),
            start_time: p.start_time(),
        })
        .collect()
}

/// 不允许结束的系统关键进程（小写名，按平台区分）。
#[cfg(windows)]
const PROTECTED_PROCESSES: &[&str] = &[
    "system",
    "registry",
    "smss.exe",
    "csrss.exe",
    "wininit.exe",
    "services.exe",
    "lsass.exe",
    "winlogon.exe",
    "svchost.exe",
    "dwm.exe",
];

/// POSIX 上的关键进程：init/systemd 与内核线程一旦被杀，整机或会话即崩。
#[cfg(not(windows))]
const PROTECTED_PROCESSES: &[&str] = &[
    "init",
    "systemd",
    "kernel_task",
    "launchd",
    "kthreadd",
    "syslogd",
    "dbus-daemon",
];

/// 不允许终止的 PID：Windows 的 0/4 是 System 与空闲进程；
/// POSIX 的 0/1 是内核调度与 init。
#[cfg(windows)]
const PROTECTED_PIDS: &[u32] = &[0, 4];
#[cfg(not(windows))]
const PROTECTED_PIDS: &[u32] = &[0, 1];

/// 终止前的身份校验（保护名单 + 存活 + 防自杀），普通结束与提权结束共用。
/// 目标身份先刷新再校验：拿到的是旧快照时，PID 可能已被系统复用给别的进程，
/// 直接 kill 等于误杀。刷新后重新确认名字不是关键进程才放行。
/// 校验通过返回刷新后的进程名（小写），供调用方记录日志。
pub fn validate_termination_target(pid: u32) -> Result<String, String> {
    if PROTECTED_PIDS.contains(&pid) {
        return Err(format!("拒绝终止系统关键进程 PID={pid}"));
    }
    // 不允许杀掉本应用自身：would orphan the WebView and look like a crash
    if pid == std::process::id() {
        return Err("拒绝终止当前应用自身".to_string());
    }
    let mut sys = System::new_all();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let target = Pid::from_u32(pid);
    match sys.process(target) {
        Some(p) => {
            let name = p.name().to_string_lossy().to_ascii_lowercase();
            if PROTECTED_PROCESSES.contains(&name.as_str()) {
                return Err(format!("拒绝终止系统关键进程「{name}」"));
            }
            Ok(name)
        }
        None => Err(format!("找不到进程 {pid}")),
    }
}

/// 按 PID 取当前进程名（小写）。每次实时刷新，不读快照缓存——
/// 提权路径的二次身份比对必须看「此刻」的名字，旧快照会掩盖 PID 复用。
/// 进程不存在（已退出）返回 None。
pub fn process_name_by_pid(pid: u32) -> Option<String> {
    let mut sys = System::new_all();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    sys.process(Pid::from_u32(pid))
        .map(|p| p.name().to_string_lossy().to_ascii_lowercase())
}

/// 结束指定进程（不可逆，前端必须二次确认后才调用）。
pub fn terminate_process(pid: u32) -> Result<(), String> {
    validate_termination_target(pid)?;
    // 有意为之的双刷新：validate 与 kill 句柄各需一份目标数据
    // （校验通过后不能拿着校验时的旧 System 直接取句柄，进程可能刚好变化）；
    // 单次人工操作性能不敏感，不为此合并重构。
    let mut sys = System::new_all();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let target = Pid::from_u32(pid);
    match sys.process(target) {
        Some(p) => {
            if p.kill() {
                Ok(())
            } else {
                Err("进程拒绝终止或已退出".to_string())
            }
        }
        None => Err(format!("找不到进程 {pid}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protected_pids_are_rejected() {
        for pid in PROTECTED_PIDS {
            assert!(terminate_process(*pid).is_err(), "PID {pid} 必须被拒绝");
        }
    }

    #[test]
    fn refusing_to_kill_self() {
        assert!(terminate_process(std::process::id()).is_err());
    }

    #[test]
    fn protected_names_cover_platform_critical_processes() {
        // Windows 上 svchost/dwm 也能终结系统响应，必须在内
        #[cfg(windows)]
        {
            assert!(PROTECTED_PROCESSES.contains(&"lsass.exe"));
            assert!(PROTECTED_PROCESSES.contains(&"svchost.exe"));
        }
        #[cfg(not(windows))]
        {
            assert!(PROTECTED_PROCESSES.contains(&"systemd"));
            assert!(PROTECTED_PROCESSES.contains(&"init"));
        }
    }

    #[test]
    fn run_quiet_captures_stdout() {
        #[cfg(windows)]
        let (prog, args) = ("cmd", vec!["/c", "echo", "hello"]);
        #[cfg(not(windows))]
        let (prog, args) = ("echo", vec!["hello"]);
        let out = run_quiet(prog, &args).expect("应能执行");
        assert!(out.to_lowercase().contains("hello"), "got: {out}");
    }
}
