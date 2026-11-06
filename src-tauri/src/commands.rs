//! IPC 命令层：前端 invoke 的唯一入口。阻塞工作全部丢进 spawn_blocking。

use tauri::{AppHandle, Manager};

use crate::ai::{self, AiProcess, OpencodeSession, SessionDetail, SessionFilePreview};
use crate::cost_store::{
    self, CostExportRow, CostOverview, CostSettings, CostTrendRow, ExtendedTrend,
    ModelBreakdownRow, ProjectBreakdownRow,
};
use crate::data::{self, WorkbenchData};
use crate::devserver::{self, DevServer};
use crate::diagnostics::{self, DiagnosticsReport};
use crate::ipc_guard::{AllowedPorts, KnownDirs};
use crate::paths::DataRoot;
use crate::ports::{self, PortEntry};
use crate::pricing::PricingTable;
use crate::procs::{self, ProcInfo};
use crate::session_meter::{self, SessionFileEntry};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;

/// 桌面壳里把 Tauri 的 `app_data_dir()` 收敛成 `DataRoot`。
///
/// 后端聚合层不再接受 `&AppHandle`，这样同一套逻辑在 CLI 与 HTTP 服务里
/// 也能跑；这里只是「桌面入口 → 显式路径」的一次转换。
fn data_root(app: &AppHandle) -> Result<DataRoot, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位数据目录: {e}"))?;
    Ok(DataRoot::new(dir).ensure()?.clone())
}

/// 派生外部命令（Windows 上不闪控制台窗口）。
///
/// 目前只有 git 探测走这里；端口采集已统一到 procs::run_quiet
/// （按平台选 netstat / ss）。
fn silent(cmd: Command) -> Command {
    #[cfg(windows)]
    let mut cmd = cmd;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // 0x08000000 = CREATE_NO_WINDOW
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

/// 端口采样短缓存。`list_ports` 与 `list_dev_servers` 在一次前端刷新里
/// 各要一份端口表，原先各起一次采集子进程；这里让同一刷新周期共享。
const PORTS_TTL: std::time::Duration = std::time::Duration::from_millis(400);

fn cached_port_entries() -> Result<Vec<PortEntry>, String> {
    use std::sync::Mutex;
    use std::time::Instant;
    static CACHE: Mutex<Option<(Instant, Vec<PortEntry>)>> = Mutex::new(None);

    let mut guard = CACHE.lock().unwrap_or_else(|p| p.into_inner());
    if let Some((at, entries)) = guard.as_ref() {
        if at.elapsed() < PORTS_TTL {
            return Ok(entries.clone());
        }
    }
    let entries = ports::collect()?;
    *guard = Some((Instant::now(), entries.clone()));
    Ok(entries)
}

/// 构建 PID 索引哈希表（消除 O(n*m) 端口→进程扫描）
fn build_pid_index(procs: Vec<ProcInfo>) -> HashMap<u32, ProcInfo> {
    procs.into_iter().map(|p| (p.pid, p)).collect()
}

#[tauri::command(async)]
pub async fn list_processes() -> Result<Vec<ProcInfo>, String> {
    tauri::async_runtime::spawn_blocking(procs::snapshot_processes)
        .await
        .map_err(|e| format!("任务执行失败: {e}"))
}

#[tauri::command(async)]
pub async fn terminate_process(pid: u32) -> Result<(), String> {
    log::info!("请求终止进程 PID={pid}");
    let result = tauri::async_runtime::spawn_blocking(move || procs::terminate_process(pid))
        .await
        .map_err(|e| format!("任务执行失败: {e}"))?;
    // 终止后强制刷新快照，否则前端立刻刷新时可能读到 400ms 内的旧快照
    if result.is_ok() {
        let _ = tauri::async_runtime::spawn_blocking(procs::snapshot_processes_fresh).await;
    }
    result
}

// ── 以管理员结束进程（Windows UAC）──────────────────────────

/// 构造提权 taskkill 的命令行参数（纯函数，单测不碰 UAC）。
/// `/T` 连同子进程树一起结束，`/F` 强制终止。
/// 参数只准放 u32 派生值：pid 经 to_string 进入本函数，不存在注入面；
/// 未来若加字符串参数，必须改参数化传递（args 数组），严禁拼进单一命令串。
#[cfg(windows)]
fn elevated_taskkill_args(pid: u32) -> Vec<String> {
    vec![
        "/PID".to_string(),
        pid.to_string(),
        "/T".to_string(),
        "/F".to_string(),
    ]
}

/// 以 runas verb 启动 taskkill（经 PowerShell `Start-Process -Verb RunAs`，
/// 底层即 ShellExecute runas），触发 UAC 提权弹窗并等待其退出。
/// 用户在 UAC 点「否」或 taskkill 失败都会以非零码退出，映射为 Err。
#[cfg(windows)]
fn run_elevated_taskkill(pid: u32) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    // PassThru + exit <code>：把提权 taskkill 的退出码透传回来，
    // 否则 Start-Process 失败也返回 0，调用方无法区分「拒绝 UAC」和「成功」。
    let arglist = elevated_taskkill_args(pid)
        .iter()
        .map(|a| format!("'{a}'"))
        .collect::<Vec<_>>()
        .join(",");
    let script = format!(
        "$p = Start-Process -FilePath taskkill -ArgumentList {arglist} \
         -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode"
    );
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("启动提权命令失败: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "提权结束失败（UAC 被拒绝或 taskkill 出错）: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

/// 非 Windows 平台没有 UAC 概念，直接拒绝（调用方应走普通 terminate_process）。
#[cfg(not(windows))]
fn run_elevated_taskkill(_pid: u32) -> Result<(), String> {
    Err("仅 Windows 支持提权结束".to_string())
}

/// 二次身份比对（纯函数，单测不碰 UAC）：首次校验通过后到实际 spawn 之间
/// 存在等待窗口（前端延迟 + UAC 弹窗停留时间，可达数十秒），目标退出后
/// PID 会被系统复用给无关进程，直接 taskkill 等于误杀。因此 spawn 前按
/// 「PID + 进程名」再比对一次：目标已退出（None）或名字与首次校验不一致
/// 都必须拒绝，宁可少杀不可错杀。
fn verify_elevated_target_unchanged(
    fresh_name: Option<String>,
    expected_name: &str,
) -> Result<(), String> {
    match fresh_name {
        Some(name) if name == expected_name => Ok(()),
        Some(name) => Err(format!(
            "目标进程已退出或 PID 已被复用（首次校验「{expected_name}」，现名「{name}」）"
        )),
        None => Err("目标进程已退出或 PID 已被复用".to_string()),
    }
}

/// 以管理员权限结束进程：`taskkill /PID <pid> /T /F` 经 UAC runas 启动。
/// 与普通 terminate_process 共用 procs.rs 的同一份保护名单：受保护进程
/// （System/lsass 等）在提权路径下同样直接拒绝，UAC 通过也不例外。
/// 安全注记：校验通过后仍存在 UAC 等待窗口（用户停留在弹窗的时间不定，
/// 目标可能退出、PID 可能被复用），故在 spawn 前按「PID + 进程名」做
/// 第二次比对（verify_elevated_target_unchanged），不一致直接拒绝、不弹 UAC。
#[tauri::command(async)]
pub async fn terminate_process_elevated(pid: u32) -> Result<(), String> {
    log::info!("请求提权终止进程 PID={pid}");
    tauri::async_runtime::spawn_blocking(move || {
        let name = procs::validate_termination_target(pid)?;
        // 二次校验：实时取当前进程名，与首次校验比对，防窗口期 PID 复用误杀
        let fresh = procs::process_name_by_pid(pid);
        verify_elevated_target_unchanged(fresh, &name)?;
        run_elevated_taskkill(pid)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

#[tauri::command(async)]
pub async fn list_ports() -> Result<Vec<PortEntry>, String> {
    tauri::async_runtime::spawn_blocking(cached_port_entries)
        .await
        .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 开发服务器 = LISTENING 的 TCP 端口 + 命令行命中框架规则的进程。
#[tauri::command(async)]
pub async fn list_dev_servers(dirs: tauri::State<'_, KnownDirs>) -> Result<Vec<DevServer>, String> {
    let servers = tauri::async_runtime::spawn_blocking(|| -> Result<Vec<DevServer>, String> {
        let ports = cached_port_entries()?;
        let procs = procs::snapshot_processes();
        let pid_index = build_pid_index(procs);

        let mut servers = Vec::new();
        for entry in ports.iter().filter(|e| e.protocol == "TCP") {
            if !ports::is_listening(&entry.state) || entry.local_port == 0 {
                continue;
            }
            let proc = match pid_index.get(&entry.pid) {
                Some(p) => p,
                None => continue,
            };
            let cmd_lower = proc.cmd_line.to_ascii_lowercase();
            let exe_name_lower = std::path::Path::new(&proc.exe_path)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default()
                .to_ascii_lowercase();
            let classified = devserver::classify_dev_server(&cmd_lower, &exe_name_lower);
            if let Some((framework, confidence)) = classified {
                // 用结构化 argv 而不是把 cmd_line 按空格重切：含空格的路径
                // 会被切碎，推出一个不存在的相对目录并被登记进白名单。
                let project_dir =
                    devserver::guess_project_dir(&proc.argv, &proc.exe_path, &proc.cwd);
                servers.push(DevServer {
                    port: entry.local_port,
                    protocol: entry.protocol.clone(),
                    pid: entry.pid,
                    process_name: proc.name.clone(),
                    framework: framework.to_string(),
                    project_dir,
                    cmd_line: proc.cmd_line.clone(),
                    confidence,
                });
            }
        }
        servers.sort_by_key(|s| s.port);
        servers.dedup_by_key(|s| s.port);
        Ok(servers)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))??;

    // 这些目录会以 project_dir 的形式回到前端，再被 git_branch / open_path 传回来，
    // 因此同步登记为「后端主动展示过的目录」。
    dirs.record(
        servers
            .iter()
            .filter_map(|s| s.project_dir.as_deref())
            .filter(|d| !d.is_empty()),
    );
    Ok(servers)
}

#[tauri::command(async)]
pub async fn list_ai_processes() -> Result<Vec<AiProcess>, String> {
    tauri::async_runtime::spawn_blocking(|| Ok(crate::runtime::collect_ai_processes()))
        .await
        .map_err(|e| format!("任务执行失败: {e}"))?
}

/// opencode 会话列表 + 实际命中的服务端口（前端详情请求必须复用该端口）。
#[derive(serde::Serialize, ts_rs::TS)]
pub struct OpencodeSessionsResult {
    pub port: u16,
    pub sessions: Vec<OpencodeSession>,
}

/// 拉取 opencode 在线会话。端口发现：默认 4096 + AI 进程命令行里的 --port；
/// 逐个尝试直到成功，全部失败才报错。
#[tauri::command(async)]
pub async fn opencode_sessions(
    ports_state: tauri::State<'_, AllowedPorts>,
) -> Result<OpencodeSessionsResult, String> {
    let result = tauri::async_runtime::spawn_blocking(|| {
        let procs = procs::snapshot_processes();
        let mut ports = vec![4096u16];
        ports.extend(discover_opencode_ports(&procs));
        ports.sort();
        ports.dedup();
        let mut last_err = String::new();
        for port in ports {
            match ai::fetch_opencode_sessions(port) {
                Ok(sessions) => return Ok(OpencodeSessionsResult { port, sessions }),
                Err(e) => last_err = e,
            }
        }
        log::warn!("opencode 服务未检测到（默认端口 4096）: {last_err}");
        Err(format!(
            "未检测到运行中的 opencode 服务（默认端口 4096）：{last_err}"
        ))
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))??;

    // 只允许详情请求复用刚刚探测成功的端口
    ports_state.record([result.port]);
    Ok(result)
}

fn discover_opencode_ports(procs: &[ProcInfo]) -> Vec<u16> {
    // 端口发现逻辑与 HTTP 服务共用一份，避免两处漏掉 `--port=` 或 `--port N` 写法。
    crate::runtime::collect_opencode_ports(procs)
}

// ── AI 会话详情 ──────────────────────────────────────────

/// 拉取单个 opencode 会话详情（消息数量、预览、工具使用等）。
/// 端口必须是上一次 opencode_sessions 真正探测成功的端口。
#[tauri::command(async)]
pub async fn opencode_session_detail(
    ports_state: tauri::State<'_, AllowedPorts>,
    port: u16,
    session_id: String,
) -> Result<SessionDetail, String> {
    if !ports_state.contains(port) {
        log::warn!("拒绝未探测过的端口上的会话详情请求: {port}");
        return Err("端口不在允许列表内，请刷新会话列表".to_string());
    }
    let detail =
        tauri::async_runtime::spawn_blocking(move || ai::fetch_session_detail(port, &session_id))
            .await
            .map_err(|e| format!("任务执行失败: {e}"))?;
    Ok(detail)
}

#[tauri::command(async)]
pub async fn recent_sessions_preview() -> Result<Vec<SessionFilePreview>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let home = dirs_home().ok_or_else(|| "无法定位用户主目录".to_string())?;
        ai::scan_session_files_with_preview(&home).map_err(str::to_string)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 探测项目的 git 分支信息。只接受后端此前展示过的目录 —— `git -C <任意目录>`
/// 会执行该仓库配置的 fsmonitor / filter 钩子，恶意目录即等于本机代码执行。
#[tauri::command(async)]
pub async fn git_branch(dirs: tauri::State<'_, KnownDirs>, dir: String) -> Result<String, String> {
    if !dirs.contains(&dir) {
        log::warn!("拒绝未登记的目录 git 探测: {dir}");
        return Err("该目录不在允许列表内".to_string());
    }
    let output = tauri::async_runtime::spawn_blocking(move || {
        silent(Command::new("git"))
            .args(["-C", &dir, "branch", "--show-current"])
            .output()
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
    .map_err(|e| format!("git 执行失败: {e}"))?;
    if !output.status.success() {
        return Ok(String::new());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// 切换主窗口置顶。前端在标题栏提供开关；失败时前端回滚状态。
#[tauri::command]
pub fn set_always_on_top(window: tauri::Window, on: bool) -> Result<(), String> {
    window
        .set_always_on_top(on)
        .map_err(|e| format!("设置置顶失败: {e}"))
}

/// 用系统默认程序打开目录。同样只允许后端展示过的目录，等价于把
/// opener 的 `allow-open-path` 从 WebView 权限面里彻底拿掉。
#[tauri::command]
pub fn open_known_path(dirs: tauri::State<'_, KnownDirs>, path: String) -> Result<(), String> {
    if path.is_empty() || !dirs.contains(&path) {
        log::warn!("拒绝打开未登记的路径: {path}");
        return Err("该路径不在允许列表内".to_string());
    }
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| format!("打开失败: {e}"))
}

/// 用户主目录。Windows 用 USERPROFILE，Unix 用 HOME。
pub fn home_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("USERPROFILE")
        .filter(|v| !v.is_empty())
        .or_else(|| std::env::var_os("HOME").filter(|v| !v.is_empty()))
        .map(std::path::PathBuf::from)
}

fn dirs_home() -> Option<std::path::PathBuf> {
    home_dir()
}

// ── 系统信息 ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
pub struct SystemInfo {
    pub hostname: String,
    pub os_name: String,
    pub cpu_cores: usize,
    #[ts(type = "number")]
    pub total_memory: u64,
    #[ts(type = "number")]
    pub uptime_seconds: u64,
}

/// 系统静态信息。这些值在一次运行里几乎不变，缓存起来避免重复枚举进程表。
///
/// 原先每次刷新都 `System::new_all()`（实测 380–830ms，会枚举全部进程、
/// 环境变量、可执行路径），只为拿核数/总内存/uptime —— 每 3 秒白烧一次
/// 全量进程枚举。现在只用 memory-only 刷新（微秒级）+ 静态 API。
fn cached_system_info() -> SystemInfo {
    use std::sync::OnceLock;
    static CACHE: OnceLock<SystemInfo> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            use sysinfo::{MemoryRefreshKind, RefreshKind, System};
            // 只刷新内存总量：不需要进程、磁盘、网络信息
            let system = System::new_with_specifics(
                RefreshKind::nothing().with_memory(MemoryRefreshKind::nothing().with_ram()),
            );
            SystemInfo {
                hostname: System::host_name().unwrap_or_else(|| "Unknown".to_string()),
                os_name: System::long_os_version()
                    .or_else(System::os_version)
                    .unwrap_or_else(|| "Windows".to_string()),
                cpu_cores: std::thread::available_parallelism()
                    .map(|n| n.get())
                    .unwrap_or(0),
                total_memory: system.total_memory(),
                uptime_seconds: System::uptime(),
            }
        })
        .clone()
}

/// 同步版本：桌面 IPC 与 HTTP 服务共用，避免两处字段各写一遍。
pub fn system_info_blocking() -> SystemInfo {
    let mut info = cached_system_info();
    // uptime 会随时间走，单独刷新；其余字段（主机名/OS/核数/总内存）进程内不变
    info.uptime_seconds = sysinfo::System::uptime();
    info
}

#[tauri::command(async)]
pub async fn system_info() -> Result<SystemInfo, String> {
    tauri::async_runtime::spawn_blocking(|| Ok(system_info_blocking()))
        .await
        .map_err(|e| format!("任务执行失败: {e}"))?
}

// ── 磁盘信息 ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
pub struct DiskInfo {
    pub label: String,
    pub mount_point: String,
    #[ts(type = "number")]
    pub total_bytes: u64,
    #[ts(type = "number")]
    pub available_bytes: u64,
    #[ts(type = "number")]
    pub used_bytes: u64,
    pub is_removable: bool,
}

#[tauri::command(async)]
/// 同步版本：桌面 IPC 与 HTTP 服务共用。
pub fn disk_info_blocking() -> Vec<DiskInfo> {
    use sysinfo::Disks;
    let disks_list = Disks::new_with_refreshed_list();

    let mut disks = Vec::new();
    for d in disks_list.list() {
        let total = d.total_space();
        if total == 0 {
            continue;
        }
        let available = d.available_space();
        let label = d.name().to_string_lossy().into_owned();
        if label.is_empty() {
            let mp = d.mount_point();
            if mp == std::path::Path::new("/") {
                continue;
            }
        }
        disks.push(DiskInfo {
            label: if label.is_empty() {
                d.mount_point().to_string_lossy().into_owned()
            } else {
                label
            },
            mount_point: d.mount_point().to_string_lossy().into_owned(),
            total_bytes: total,
            available_bytes: available,
            used_bytes: total.saturating_sub(available),
            is_removable: d.is_removable(),
        });
    }
    disks
}

#[tauri::command(async)]
pub async fn disk_info() -> Result<Vec<DiskInfo>, String> {
    tauri::async_runtime::spawn_blocking(|| Ok(disk_info_blocking()))
        .await
        .map_err(|e| format!("任务执行失败: {e}"))?
}

#[tauri::command(async)]
pub async fn load_data(
    app: AppHandle,
    dirs: tauri::State<'_, KnownDirs>,
) -> Result<WorkbenchData, String> {
    let data = data::load_from_disk(&data_root(&app)?)?;
    // data.json 可能被外部编辑过，回灌白名单时同样要过存在性校验。
    // 校验含 Path::is_dir()：断开的 UNC / 映射盘会阻塞数秒，
    // 因此必须在 spawn_blocking 里做（这两个命令原先是非 async，跑在主线程）。
    let paths: Vec<String> = data.projects.iter().map(|p| p.path.clone()).collect();
    let total = paths.len();
    let accepted = dirs.record_validated_blocking(paths).await?;
    log::debug!("从 data.json 登记 {accepted} 个有效项目目录（共 {total} 个）");
    Ok(data)
}

#[derive(Serialize)]
pub struct VersionedWorkbenchData {
    data: WorkbenchData,
    generation: String,
}

#[tauri::command(async)]
pub async fn load_data_versioned(
    app: AppHandle,
    dirs: tauri::State<'_, KnownDirs>,
) -> Result<VersionedWorkbenchData, String> {
    let snapshot = tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock_ledger_operation()?;
        let data = data::load_from_disk(&data_root(&app)?)?;
        let generation = DATA_RESTORE_GENERATION.load(std::sync::atomic::Ordering::Acquire);
        Ok::<_, String>(VersionedWorkbenchData {
            data,
            generation: generation.to_string(),
        })
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))??;
    let paths = snapshot
        .data
        .projects
        .iter()
        .map(|p| p.path.clone())
        .collect();
    dirs.record_validated_blocking(paths).await?;
    Ok(snapshot)
}

#[tauri::command(async)]
pub async fn save_data(
    app: AppHandle,
    dirs: tauri::State<'_, KnownDirs>,
    data: WorkbenchData,
    generation: Option<String>,
) -> Result<String, String> {
    let started = DATA_RESTORE_GENERATION.load(std::sync::atomic::Ordering::Acquire);
    log::debug!(
        "持久化数据: {} 项目 {} 任务",
        data.projects.len(),
        data.tasks.len()
    );
    // 入参来自 WebView：只登记真实存在的绝对目录，避免注入脚本借 save_data
    // 把任意目录灌进白名单后，再用 git_branch / open_known_path 触达它。
    // 存在性校验会触碰文件系统，放进阻塞线程，避免断网盘卡住主线程。
    let paths: Vec<String> = data.projects.iter().map(|p| p.path.clone()).collect();
    let accepted = dirs.record_validated_blocking(paths).await?;
    log::debug!("save_data 登记 {accepted} 个项目目录");
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock_ledger_operation()?;
        save_with_restore_generation(
            generation.as_deref(),
            started,
            &DATA_RESTORE_GENERATION,
            || data::save_to_disk(&data_root(&app2)?, &data),
        )
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

// ── 日志读取 ──────────────────────────────────────────────

#[tauri::command]
pub fn read_logs(app: AppHandle, max_lines: usize) -> String {
    crate::logging_setup::read_recent_logs(&app, max_lines)
}

#[tauri::command]
pub fn clear_logs(app: AppHandle) -> Result<(), String> {
    crate::logging_setup::clear_logs(&app)
}

// ════════════════════════════════════════════════════════════
// 成本计量相关 IPC 命令
// ════════════════════════════════════════════════════════════

static SCAN_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
static DATA_RESTORE_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn ensure_restore_generation(
    generation: u64,
    current: &std::sync::atomic::AtomicU64,
) -> Result<(), String> {
    if current.load(std::sync::atomic::Ordering::Acquire) != generation {
        return Err("数据已被其他操作修改；请先导出未保存数据，再重新加载".to_string());
    }
    Ok(())
}

fn save_with_restore_generation(
    supplied: Option<&str>,
    started: u64,
    current: &std::sync::atomic::AtomicU64,
    save: impl FnOnce() -> Result<(), String>,
) -> Result<String, String> {
    ensure_restore_generation(started, current)?;
    let actual = current.load(std::sync::atomic::Ordering::Acquire);
    let supplied =
        supplied.ok_or_else(|| "旧版保存协议不可用，请先导出未保存数据并升级客户端".to_string())?;
    if supplied.parse::<u64>().ok() != Some(actual) {
        return Err("数据已被其他操作修改；请先导出未保存数据，再重新加载".to_string());
    }
    let next = actual
        .checked_add(1)
        .ok_or_else(|| "数据版本已耗尽，拒绝保存".to_string())?;
    save()?;
    current.store(next, std::sync::atomic::Ordering::Release);
    Ok(next.to_string())
}

fn lock_ledger_operation() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    SCAN_LOCK.lock().map_err(|e| format!("扫描锁失败: {e}"))
}

fn read_pricing_overrides_at(path: &std::path::Path) -> Result<cost_store::OverrideRead, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(cost_store::OverrideRead::default())
        }
        Err(e) => return Err(format!("读取 {} 失败: {e}", path.display())),
    };
    let raw: HashMap<String, (f64, f64)> = serde_json::from_str(&text).map_err(|e| {
        format!(
            "{} 内容已损坏: {e}（原文件保留，请修复或重置定价）",
            path.display()
        )
    })?;
    let mut result = cost_store::OverrideRead::default();
    for (model, (input, output)) in raw {
        match PricingTable::validate_override(&model, input, output) {
            Ok((key, pair)) => {
                result.overrides.insert(key, pair);
            }
            Err(e) => result.problems.push(format!("{model}: {e}")),
        }
    }
    Ok(result)
}

fn read_pricing_overrides(app: &AppHandle) -> Result<cost_store::OverrideRead, String> {
    read_pricing_overrides_at(&cost_store::cost_data_path_overrides(&data_root(app)?))
}

/// 扫描 session JSONL 文件 → 提取 usage → 计算成本 → 写入 SQLite 成本库
/// 注意：成本计量必须全量扫描（不受 UI 预览的 10 条上限影响）。
#[tauri::command(async)]
pub async fn scan_session_costs(app: AppHandle) -> Result<ScanCostResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _scan_guard = lock_ledger_operation()?;
        let home = dirs_home().ok_or_else(|| "无法定位用户主目录".to_string())?;
        let session_files = ai::collect_all_session_files(&home).map_err(str::to_string)?;

        let entries: Vec<SessionFileEntry> = session_files
            .iter()
            .map(|f| SessionFileEntry {
                path: f.path.clone(),
                tool: f.tool.clone(),
                project: f.project.clone(),
                modified: f.modified,
                size: f.size,
            })
            .collect();

        let overrides = read_pricing_overrides(&app)?;
        if !overrides.problems.is_empty() {
            return Err(format!("定价覆盖无效: {}", overrides.problems.join("; ")));
        }
        let pricing_table = PricingTable {
            overrides: overrides.overrides,
        };
        let mut records = Vec::new();
        let mut scanned_paths = Vec::new();
        let mut errors = Vec::new();
        // 单文件上限之外的兜底：一次扫描最多读 256 MiB。否则 10,000 个文件
        // 各 32 MiB 就是 312 GiB，长时间持锁且拖慢整个应用。到顶后剩余文件
        // 按失败上报（保留旧账），不静默截断成"扫描成功"。
        const SCAN_TOTAL_BYTES: u64 = 256 * 1024 * 1024;
        let mut bytes_budget = session_meter::ScanReadBudget::new(SCAN_TOTAL_BYTES);
        for entry in &entries {
            match session_meter::scan_complete_sessions_with_budget(
                std::slice::from_ref(entry),
                &pricing_table,
                &mut bytes_budget,
            ) {
                Ok(file_records) => {
                    records.extend(file_records);
                    scanned_paths.push(entry.path.clone());
                }
                Err(err) => errors.push(err),
            }
        }
        let total_scanned = records.len();
        let outcome =
            cost_store::import_and_aggregate(&data_root(&app)?, &records, &scanned_paths, 14)?;
        if !errors.is_empty() {
            return Err(format!(
                "{} 个会话扫描失败，旧记录已保留；成功文件已更新: {}",
                errors.len(),
                errors.join("; ")
            ));
        }

        Ok(ScanCostResult {
            new_records: outcome.net_new,
            total_scanned,
            overview: outcome.overview,
            trend: outcome.trend,
            model_breakdown: outcome.breakdown,
        })
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

// 成本读取全部走 spawn_blocking：SQLite 查询是同步阻塞调用，
// 而 Tauri 的非 async 命令在主线程执行 —— 前端进入 AI 页时用 Promise.all
// 同时发 4 个查询，在主线程上就是数百毫秒的冻结。

/// 获取成本总览（不重新扫描）
#[tauri::command(async)]
pub async fn get_cost_overview(app: AppHandle) -> Result<CostOverview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _scan_guard = lock_ledger_operation()?;
        cost_store::build_overview(&data_root(&app)?)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 获取成本趋势
#[tauri::command(async)]
pub async fn get_cost_trend(app: AppHandle, days: usize) -> Result<Vec<CostTrendRow>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _scan_guard = lock_ledger_operation()?;
        cost_store::build_trend(&data_root(&app)?, days)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 按模型分解成本
#[tauri::command(async)]
pub async fn get_model_breakdown(app: AppHandle) -> Result<Vec<ModelBreakdownRow>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _scan_guard = lock_ledger_operation()?;
        cost_store::build_model_breakdown(&data_root(&app)?)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 按项目目录归因成本（"哪个仓库花钱最多"）
#[tauri::command(async)]
pub async fn get_project_breakdown(app: AppHandle) -> Result<Vec<ProjectBreakdownRow>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _scan_guard = lock_ledger_operation()?;
        cost_store::build_project_breakdown(&data_root(&app)?)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 扩展趋势：最近 `days` 天按日，更早的按月聚合
#[tauri::command(async)]
pub async fn get_cost_trend_extended(app: AppHandle, days: usize) -> Result<ExtendedTrend, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _scan_guard = lock_ledger_operation()?;
        cost_store::build_trend_extended(&data_root(&app)?, days)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 台账导出：原始成本记录（含估算行，来源列自述）
#[tauri::command(async)]
pub async fn get_cost_export(app: AppHandle, limit: usize) -> Result<Vec<CostExportRow>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _scan_guard = lock_ledger_operation()?;
        cost_store::build_cost_export(&data_root(&app)?, limit)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 获取 / 保存成本设置（预算 / 告警阈值 / 是否计入估算）
#[tauri::command(async)]
pub async fn get_cost_settings_cmd(app: AppHandle) -> Result<CostSettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _scan_guard = lock_ledger_operation()?;
        cost_store::get_cost_settings(&data_root(&app)?)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

#[tauri::command(async)]
pub async fn save_cost_settings_cmd(app: AppHandle, settings: CostSettings) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _scan_guard = lock_ledger_operation()?;
        cost_store::save_cost_settings(&data_root(&app)?, settings)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 清空全部成本记录
#[tauri::command(async)]
pub async fn clear_cost_records(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _scan_guard = lock_ledger_operation()?;
        cost_store::clear_records(&data_root(&app)?)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 扫描结果回传
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
pub struct ScanCostResult {
    pub new_records: usize,
    pub total_scanned: usize,
    pub overview: CostOverview,
    pub trend: Vec<CostTrendRow>,
    pub model_breakdown: Vec<ModelBreakdownRow>,
}

/// 一个可恢复的备份点。
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
pub struct BackupPoint {
    /// 备份目录名（时间戳），作为恢复时的 id
    pub id: String,
    /// 绝对路径，便于界面上显示
    pub dir: String,
    /// 该备份里包含的文件名
    pub files: Vec<String>,
    /// 目录修改时间（unix 秒）
    #[ts(type = "number")]
    pub created_at: u64,
}

/// 一次完整备份的结果。
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
pub struct BackupResult {
    pub dir: String,
    pub files: Vec<String>,
    /// 被跳过（不存在）的文件名，不算错误
    pub skipped: Vec<String>,
}

/// 备份根目录（`<data dir>/backups`）。
fn backups_root(root: &DataRoot) -> std::path::PathBuf {
    root.backups_dir()
}

/// 三份数据文件的 (名字, 真实路径) 列表。
fn data_files(root: &DataRoot) -> Vec<(&'static str, std::path::PathBuf)> {
    vec![
        ("data.json", data::data_file_path(root)),
        ("cost.db", cost_store::cost_db_path(root)),
        (
            "pricing_overrides.json",
            cost_store::cost_data_path_overrides(root),
        ),
    ]
}

/// 备份目录名是否为 `YYYYMMDD-HHMMSS`。
///
/// 这个格式同时承担两个作用：排序键，以及「恢复时 id 不能是路径」的安全边界。
fn is_backup_id(id: &str) -> bool {
    id.len() == 15
        && id.as_bytes()[8] == b'-'
        && id
            .chars()
            .enumerate()
            .all(|(i, c)| if i == 8 { c == '-' } else { c.is_ascii_digit() })
}

/// 一次完整备份：把三份数据文件复制到带时间戳的目录。
///
/// 为什么写到应用自己的数据目录：选目录需要额外的对话框插件（新依赖），
/// 而备份的价值在于「一键且不丢」。固定目标也不会因为用户选到只读盘而失败。
#[tauri::command(async)]
pub async fn backup_data(app: AppHandle) -> Result<BackupResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _scan_guard = lock_ledger_operation()?;
        backup_now(&app)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 同步版本：`restore_backup` 要在同一个阻塞线程里先备份再恢复。
fn backup_now(app: &AppHandle) -> Result<BackupResult, String> {
    let data_root_ = data_root(app)?;
    let root = backups_root(&data_root_);
    std::fs::create_dir_all(&root).map_err(|e| format!("创建备份目录失败: {e}"))?;

    // 目录名精确到秒，但「恢复」会在同一秒内先做一次安全备份：
    // 若直接 join(stamp)，两次会落进同一个目录，安全备份就把源备份覆盖了
    // ——恢复等于什么都没做，还毁掉了可用的备份点（实测踩到）。
    // 因此这里用 create_dir 的原子性占位，冲突就等到下一秒再试。
    let mut stamp = String::new();
    let mut out_dir = std::path::PathBuf::new();
    for _ in 0..2100 {
        let candidate = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
        let dir = root.join(&candidate);
        match std::fs::create_dir(&dir) {
            Ok(()) => {
                stamp = candidate;
                out_dir = dir;
                break;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                // 同一秒已被占用：等到下一秒（最多等 ~1 秒）
                std::thread::sleep(std::time::Duration::from_millis(50));
                continue;
            }
            Err(e) => return Err(format!("创建备份目录失败: {e}")),
        }
    }
    if stamp.is_empty() {
        return Err("无法创建唯一的备份目录（同一秒冲突过多）".to_string());
    }

    let mut files = Vec::new();
    let mut skipped = Vec::new();
    for (name, src) in data_files(&data_root_) {
        if !src.exists() {
            skipped.push(name.to_string());
            continue;
        }
        // 先写临时名再改名：备份中途失败不会留下半个文件。
        // SQLite 必须用 VACUUM INTO 而不是直接复制：应用可能正在写入，
        // 复制会拿到「主文件已改、日志未合并」的中间态。
        let dst = out_dir.join(name);
        let tmp = out_dir.join(format!("{name}.tmp"));
        if name.ends_with(".db") {
            cost_store::snapshot_db(&data_root_, &tmp)?;
        } else {
            std::fs::copy(&src, &tmp).map_err(|e| format!("复制 {name} 失败: {e}"))?;
        }
        std::fs::rename(&tmp, &dst).map_err(|e| format!("落盘 {name} 失败: {e}"))?;
        files.push(name.to_string());
    }
    if files.is_empty() {
        // 一份都没备份出来：删掉空目录，否则备份列表里会出现空条目
        let _ = std::fs::remove_dir(&out_dir);
        return Err("没有可备份的数据文件".to_string());
    }
    log::info!(
        "数据备份完成: {} 个文件 -> {}",
        files.len(),
        out_dir.display()
    );
    Ok(BackupResult {
        dir: out_dir.to_string_lossy().to_string(),
        files,
        skipped,
    })
}

/// 列出所有备份点（新的在前）。
#[tauri::command(async)]
pub async fn list_backups(app: AppHandle) -> Result<Vec<BackupPoint>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = backups_root(&data_root(&app)?);
        let mut out = Vec::new();
        let entries = match std::fs::read_dir(&root) {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
            Err(e) => return Err(format!("读取备份目录失败: {e}")),
        };
        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let id = entry.file_name().to_string_lossy().to_string();
            // 只认我们自己的命名格式，避免把用户手放的目录当备份
            if !is_backup_id(&id) {
                continue;
            }
            let mut files = Vec::new();
            if let Ok(inner) = std::fs::read_dir(entry.path()) {
                for f in inner.flatten() {
                    let n = f.file_name().to_string_lossy().to_string();
                    if n.ends_with(".json") || n.ends_with(".db") {
                        files.push(n);
                    }
                }
            }
            if files.is_empty() {
                continue;
            }
            files.sort();
            let created_at = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            out.push(BackupPoint {
                dir: entry.path().to_string_lossy().to_string(),
                id,
                files,
                created_at,
            });
        }
        out.sort_by(|a, b| b.id.cmp(&a.id));
        Ok(out)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 恢复结果。
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
pub struct RestoreResult {
    /// 恢复前自动生成的备份目录（选错备份点时的回退位置）
    pub safety_backup: String,
    pub restored: Vec<String>,
    /// 备份里没有、因此保持原样的文件
    pub untouched: Vec<String>,
}

/// 从指定备份恢复。
///
/// 安全设计（缺一不可）：
/// 1. **恢复前先自动备份当前状态**——恢复是破坏性操作，
///    用户选错备份点时还能退回。
/// 2. **id 只允许时间戳格式**，不接受路径，杜绝 `../../` 穿越。
/// 3. **先校验每份 JSON 可解析再落盘**：把损坏的备份写回去等于毁掉好数据。
#[tauri::command(async)]
pub async fn restore_backup(app: AppHandle, id: String) -> Result<RestoreResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _scan_guard = lock_ledger_operation()?;
        restore_now(&app, &id)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

fn validate_restore_json(name: &str, text: &str) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("备份 {name} 不是合法 JSON: {e}"))?;
    if !value.is_object() {
        return Err(format!("备份 {name} 顶层不是对象，拒绝恢复"));
    }
    if name == "data.json" {
        serde_json::from_value::<WorkbenchData>(value)
            .map_err(|e| format!("备份 {name} 数据格式不兼容，拒绝恢复: {e}"))?;
    }
    Ok(())
}

fn restore_now(app: &AppHandle, id: &str) -> Result<RestoreResult, String> {
    if !is_backup_id(id) {
        return Err("非法的备份 id".to_string());
    }
    let src_dir = backups_root(&data_root(app)?).join(id);
    if !src_dir.is_dir() {
        return Err(format!("备份不存在: {id}"));
    }

    let mut plan: Vec<(&'static str, std::path::PathBuf, std::path::PathBuf)> = Vec::new();
    let mut untouched = Vec::new();
    for (name, dest) in data_files(&data_root(app)?) {
        let src = src_dir.join(name);
        if !src.exists() {
            untouched.push(name.to_string());
            continue;
        }
        if name.ends_with(".db") {
            // SQLite 备份：完整性检查 + 必须有 records 表。用只读连接校验，
            // 坏文件在这里就被拦住，不会覆盖掉能用的库。
            cost_store::validate_db(&src).map_err(|e| format!("备份 {name} 不可用: {e}"))?;
        } else {
            let text =
                std::fs::read_to_string(&src).map_err(|e| format!("读取备份 {name} 失败: {e}"))?;
            validate_restore_json(name, &text)?;
        }
        plan.push((name, src, dest));
    }
    if plan.is_empty() {
        return Err("该备份里没有可恢复的文件".to_string());
    }

    // 2) 校验通过后才备份当前状态（回退点）
    let safety = backup_now(app)?;

    // 3) 逐个原子替换（临时文件 + rename，避免写一半）
    let mut restored = Vec::new();
    for (name, src, dest) in plan {
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }
        let tmp = dest.with_extension("restore-tmp");
        std::fs::copy(&src, &tmp).map_err(|e| format!("复制 {name} 失败: {e}"))?;
        if name == "data.json" {
            let text =
                std::fs::read_to_string(&tmp).map_err(|e| format!("读取备份 {name} 失败: {e}"))?;
            if let Err(error) = validate_restore_json(name, &text) {
                let _ = std::fs::remove_file(&tmp);
                return Err(error);
            }
        }
        std::fs::rename(&tmp, &dest).map_err(|e| format!("替换 {name} 失败: {e}"))?;
        if name == "data.json" {
            DATA_RESTORE_GENERATION.fetch_add(1, std::sync::atomic::Ordering::AcqRel);
        }
        if name.ends_with(".db") {
            // 旧库的 -wal / -shm / -journal 若残留，SQLite 会把旧事务重放到
            // 新文件上，恢复出来的数据等于错的。
            cost_store::clear_sidecars(&dest);
        }
        restored.push(name.to_string());
    }
    log::info!(
        "已从备份 {id} 恢复 {} 个文件（回退点 {}）",
        restored.len(),
        safety.dir
    );
    Ok(RestoreResult {
        safety_backup: safety.dir,
        restored,
        untouched,
    })
}

/// 打开备份目录（只允许应用数据目录下的 `backups`）。
///
/// 不接受任意路径：这个命令的唯一用途是「备份完成后带用户去看一眼」，
/// 若允许任意路径就等于把 open_path 暴露给 WebView。
#[tauri::command(async)]
pub async fn open_backup_dir(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("无法定位数据目录: {e}"))?;
        let dir = base.join("backups");
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建备份目录失败: {e}"))?;
        tauri_plugin_opener::open_path(&dir, None::<&str>).map_err(|e| format!("打开失败: {e}"))?;
        Ok(dir.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 定价覆盖：读取（含每条的校验错误）
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
pub struct PricingView {
    pub rows: Vec<crate::pricing::PricingRow>,
    /// 覆盖文件里被拒绝的条目及原因（例如单价为负）
    pub problems: Vec<String>,
    /// 覆盖文件路径，便于用户手动备份/编辑
    pub path: String,
}

#[tauri::command(async)]
pub async fn get_pricing(app: AppHandle) -> Result<PricingView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _scan_guard = lock_ledger_operation()?;
        let table = build_pricing_table(&app);
        let problems = read_pricing_overrides(&app)?.problems;
        let path = cost_store::cost_data_path_overrides(&data_root(&app)?)
            .to_string_lossy()
            .to_string();
        Ok(PricingView {
            rows: table.rows(),
            problems,
            path,
        })
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 保存定价覆盖。整体替换：UI 传什么就是什么（含删除某条覆盖）。
///
/// 这里是**全部校验后才写**：任一条非法就整体拒绝，不做「跳过坏的、写入好的」——
/// 部分成功会让界面上的价格表和磁盘上的不一致，用户无法判断到底生效了什么。
#[tauri::command(async)]
pub async fn save_pricing(
    app: AppHandle,
    overrides: HashMap<String, (f64, f64)>,
) -> Result<PricingView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut clean: HashMap<String, (f64, f64)> = HashMap::new();
        let mut problems: Vec<String> = Vec::new();
        for (model, (input, output)) in overrides {
            match crate::pricing::PricingTable::validate_override(&model, input, output) {
                Ok((key, pair)) => {
                    clean.insert(key, pair);
                }
                Err(e) => problems.push(format!("{model}: {e}")),
            }
        }
        if !problems.is_empty() {
            return Err(problems.join("；"));
        }
        let _scan_guard = lock_ledger_operation()?;
        cost_store::save_pricing_overrides(&data_root(&app)?, &clean)?;
        let table = build_pricing_table(&app);
        let path = cost_store::cost_data_path_overrides(&data_root(&app)?)
            .to_string_lossy()
            .to_string();
        Ok(PricingView {
            rows: table.rows(),
            problems: Vec::new(),
            path,
        })
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 构造当前定价表 = 内置快照 + 用户覆盖文件 pricing_overrides.json。
/// 覆盖文件是可选增强：损坏时降级为内置表并告警，不能让整个成本扫描失败
/// （data.json 才是用户核心数据，那里才该「保全后上抛」）。
pub fn build_pricing_table(app: &AppHandle) -> PricingTable {
    let mut table = PricingTable::default();
    // 走与 get_pricing 相同的读取路径：坏条目被逐条拒绝并记日志，
    // 而不是整个文件被静默忽略（那会让用户以为改价生效了）。
    match read_pricing_overrides(app) {
        Ok(read) => {
            if !read.problems.is_empty() {
                log::warn!(
                    "pricing_overrides.json 有 {} 条被拒绝: {}",
                    read.problems.len(),
                    read.problems.join("; ")
                );
            }
            table.overrides = read.overrides;
        }
        Err(e) => log::warn!("pricing_overrides.json 不可用，忽略覆盖价: {e}"),
    }
    table
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn malformed_workbench_backup_must_not_replace_good_data() {
        let dir = std::env::temp_dir().join(format!("wb-schema-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("data.json");
        let src = dir.join("backup.json");
        let good = r#"{"projects":[],"tasks":[]}"#;
        std::fs::write(&dest, good).unwrap();
        std::fs::write(&src, r#"{"projects":[{"id":"x"}],"tasks":[]}"#).unwrap();
        let text = std::fs::read_to_string(&src).unwrap();
        assert!(validate_restore_json("data.json", &text).is_err());
        assert!(validate_restore_json("data.json", good).is_ok());
        assert!(validate_restore_json("data.json", r#"{"projects":[],"tasks":[{"id":"t","title":"T","status":"todo","priority":"normal","tags":[],"created_at":1,"updated_at":2}]}"#).is_ok());
        assert!(validate_restore_json(
            "data.json",
            r#"{"projects":[],"tasks":[{"id":"t","title":"T","status":"todo"}]}"#
        )
        .is_err());
        let actual = std::fs::read_to_string(&dest).unwrap();
        std::fs::remove_dir_all(dir).unwrap();
        assert_eq!(actual, good);
    }

    #[test]
    fn corrupt_pricing_repeated_reads_fail_without_losing_source() {
        let dir = std::env::temp_dir().join(format!("wb-pricing-retry-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("pricing_overrides.json");
        std::fs::write(&path, "{broken").unwrap();
        let first = read_pricing_overrides_at(&path);
        let second = read_pricing_overrides_at(&path);
        let source = std::fs::read_to_string(&path);
        std::fs::write(&path, r#"{"example-model":[1.0,2.0]}"#).unwrap();
        let repaired = read_pricing_overrides_at(&path).unwrap();
        std::fs::remove_file(&path).unwrap();
        let missing = read_pricing_overrides_at(&path).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(first.is_err());
        assert!(second.is_err(), "retry silently fell back to defaults");
        assert_eq!(source.unwrap(), "{broken");
        assert_eq!(repaired.overrides.get("example-model"), Some(&(1.0, 2.0)));
        assert!(missing.overrides.is_empty());
    }

    #[test]
    fn same_generation_saves_do_not_overwrite_each_other() {
        use std::sync::atomic::AtomicU64;
        let version = AtomicU64::new(0);
        let mut disk = String::from("initial");
        save_with_restore_generation(Some("0"), 0, &version, || {
            disk = "first".into();
            Ok(())
        })
        .unwrap();
        let second = save_with_restore_generation(Some("0"), 0, &version, || {
            disk = "second".into();
            Ok(())
        });
        assert!(second.is_err());
        assert_eq!(disk, "first");
    }

    #[test]
    fn concurrent_same_generation_writes_only_one_snapshot() {
        use std::sync::{atomic::AtomicU64, Arc, Barrier, Mutex};
        let version = Arc::new(AtomicU64::new(0));
        let disk = Arc::new(Mutex::new(String::from("initial")));
        let start = Arc::new(Barrier::new(2));
        let lock = Arc::new(Mutex::new(()));
        let workers: Vec<_> = ["first", "second"]
            .into_iter()
            .map(|value| {
                let version = version.clone();
                let disk = disk.clone();
                let start = start.clone();
                let lock = lock.clone();
                std::thread::spawn(move || {
                    start.wait();
                    let _guard = lock.lock().unwrap();
                    save_with_restore_generation(Some("0"), 0, &version, || {
                        *disk.lock().unwrap() = value.into();
                        Ok(())
                    })
                })
            })
            .collect();
        let results: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        let winner = disk.lock().unwrap().clone();
        assert!(winner == "first" || winner == "second");
        assert_eq!(
            results
                .iter()
                .find_map(|result| result.as_ref().ok())
                .unwrap(),
            "1"
        );
    }

    #[test]
    fn failed_save_does_not_advance_generation() {
        use std::sync::atomic::{AtomicU64, Ordering};
        let version = AtomicU64::new(0);
        assert!(
            save_with_restore_generation(Some("0"), 0, &version, || Err("disk".into())).is_err()
        );
        assert_eq!(version.load(Ordering::Acquire), 0);
        assert_eq!(
            save_with_restore_generation(Some("0"), 0, &version, || Ok(())).unwrap(),
            "1"
        );
    }

    #[test]
    fn legacy_save_requires_explicit_migration_before_any_write() {
        use std::sync::atomic::AtomicU64;
        let version = AtomicU64::new(0);
        let mut disk = String::from("original");
        let result = save_with_restore_generation(None, 0, &version, || {
            disk = "legacy".into();
            Ok(())
        });
        assert!(result.is_err());
        assert_eq!(disk, "original");
    }

    #[test]
    fn stale_frontend_save_after_restore_preserves_restored_fixture() {
        use std::sync::atomic::{AtomicU64, Ordering};
        let dir = std::env::temp_dir().join(format!("wb-restore-fixture-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("data.json");
        let version = AtomicU64::new(0);
        let client_generation = version.load(Ordering::Acquire).to_string();
        let stale = r#"{"projects":[],"tasks":["old"]}"#;
        let restored = r#"{"projects":[],"tasks":["restored"]}"#;
        std::fs::write(&path, restored).unwrap();
        version.fetch_add(1, Ordering::AcqRel);
        let request_generation = version.load(Ordering::Acquire);
        let stale_result = save_with_restore_generation(
            Some(&client_generation),
            request_generation,
            &version,
            || std::fs::write(&path, stale).map_err(|e| e.to_string()),
        );
        assert!(stale_result.is_err());
        let legacy_result =
            save_with_restore_generation(None, request_generation, &version, || {
                std::fs::write(&path, stale).map_err(|e| e.to_string())
            });
        assert!(legacy_result.is_err());
        let actual = std::fs::read_to_string(&path).unwrap();
        let current = version.load(Ordering::Acquire).to_string();
        save_with_restore_generation(Some(&current), request_generation, &version, || {
            std::fs::write(&path, "new").map_err(|e| e.to_string())
        })
        .unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(actual, restored, "stale client overwrote restored data");
    }

    #[test]
    fn restore_rejects_save_started_before_restore() {
        use std::sync::mpsc;
        use std::sync::{
            atomic::{AtomicU64, Ordering},
            Arc,
        };

        let version = Arc::new(AtomicU64::new(0));
        let start = version.load(Ordering::Acquire);
        let (tx, rx) = mpsc::channel();
        let copy = version.clone();
        let worker = std::thread::spawn(move || {
            copy.fetch_add(1, Ordering::AcqRel);
            tx.send(()).unwrap();
        });
        rx.recv().unwrap();
        worker.join().unwrap();
        assert!(ensure_restore_generation(start, &version).is_err());
        assert!(ensure_restore_generation(1, &version).is_ok());
    }

    #[test]
    fn save_data_shares_restore_operation_lock() {
        let source = include_str!("commands.rs");
        let body = source
            .split_once("pub async fn save_data(")
            .unwrap()
            .1
            .split_once("// ── 日志读取")
            .unwrap()
            .0;
        assert!(body.contains("lock_ledger_operation()"));
    }

    #[test]
    fn ledger_lock_serializes_concurrent_work() {
        use std::sync::mpsc;
        use std::time::Duration;

        let guard = lock_ledger_operation().unwrap();
        let (ready_tx, ready_rx) = mpsc::channel();
        let (done_tx, done_rx) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            ready_tx.send(()).unwrap();
            let _guard = lock_ledger_operation().unwrap();
            done_tx.send(()).unwrap();
        });
        ready_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let blocked = done_rx.recv_timeout(Duration::from_millis(100));
        drop(guard);
        let completed = done_rx.recv_timeout(Duration::from_secs(5));
        worker.join().unwrap();
        assert!(matches!(blocked, Err(mpsc::RecvTimeoutError::Timeout)));
        assert!(completed.is_ok());
    }

    #[test]
    fn ledger_operations_share_scan_lock() {
        let source = include_str!("commands.rs");
        for (start, end) in [
            ("pub async fn scan_session_costs(", "// 成本读取全部"),
            ("pub async fn clear_cost_records(", "/// 扫描结果回传"),
            ("pub async fn backup_data(", "/// 同步版本"),
            ("pub async fn restore_backup(", "fn restore_now("),
            ("pub async fn save_pricing(", "/// 构造当前定价表"),
        ] {
            let body = source
                .split_once(start)
                .unwrap()
                .1
                .split_once(end)
                .unwrap()
                .0;
            assert!(body.contains("lock_ledger_operation()"), "{start}");
        }
    }

    /// 备份 id 是「恢复」的唯一定位符，必须能拒绝路径穿越。
    #[test]
    fn backup_id_rejects_path_traversal() {
        assert!(is_backup_id("20261022-114208"));
        assert!(!is_backup_id("../../../etc/passwd"));
        assert!(!is_backup_id(".."));
        assert!(!is_backup_id("2026102-114208"), "长度不对必须拒绝");
        assert!(!is_backup_id("20261022_114208"), "分隔符必须是 -");
        assert!(!is_backup_id("20261022-11420a"), "必须全数字");
        assert!(!is_backup_id(r"C:\Windows"), "盘符路径必须拒绝");
        assert!(!is_backup_id(""));
    }

    // ── 提权结束进程 ──

    /// 受保护 PID（Windows 的 System / POSIX 的 init）在提权路径同样必须拒绝。
    #[test]
    fn elevated_target_rejects_protected_pids() {
        #[cfg(windows)]
        let protected = 4u32;
        #[cfg(not(windows))]
        let protected = 1u32;
        let err = procs::validate_termination_target(protected).unwrap_err();
        assert!(err.contains("拒绝"), "实际错误: {err}");
    }

    /// 本应用自身绝不允许被提权结束（提权成功等于自杀且 WebView 成孤儿）。
    #[test]
    fn elevated_target_rejects_self() {
        assert!(procs::validate_termination_target(std::process::id()).is_err());
    }

    /// taskkill 参数顺序与开关固定：/PID <pid> /T /F。
    #[cfg(windows)]
    #[test]
    fn elevated_taskkill_args_match_contract() {
        assert_eq!(
            elevated_taskkill_args(1234),
            vec![
                "/PID".to_string(),
                "1234".to_string(),
                "/T".to_string(),
                "/F".to_string()
            ]
        );
    }

    /// 二次比对：名字不一致（PID 复用）或目标已退出都必须拒绝，一致才放行。
    #[test]
    fn elevated_second_check_rejects_reused_or_dead_pid() {
        assert!(verify_elevated_target_unchanged(None, "notepad.exe").is_err());
        assert!(
            verify_elevated_target_unchanged(Some("explorer.exe".into()), "notepad.exe").is_err()
        );
        assert!(
            verify_elevated_target_unchanged(Some("notepad.exe".into()), "notepad.exe").is_ok()
        );
    }

    /// 非 Windows 平台没有 UAC，必须显式报错而不是静默降级。
    #[cfg(not(windows))]
    #[test]
    fn elevated_run_errs_off_windows() {
        let err = run_elevated_taskkill(1).unwrap_err();
        assert!(err.contains("仅 Windows"), "实际错误: {err}");
    }
}

/// 环境自检。返回每一项的 ok/warn/fail，任何一项失败都不会中断整份报告。
/// `Path::is_dir()` 可能触碰断开的网络盘，因此放到阻塞线程里执行。
#[tauri::command(async)]
pub async fn diagnostics(app: AppHandle) -> Result<DiagnosticsReport, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位数据目录: {e}"))?;
    let version = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || diagnostics::collect(&version, &data_dir))
        .await
        .map_err(|e| format!("任务执行失败: {e}"))
}
