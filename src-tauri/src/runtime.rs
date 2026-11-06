//! 运行时服务层：把「读进程 / 读端口 / 读磁盘 / 读系统信息」这些能力
//! 从 Tauri 的 IPC 命令里抽出来，供桌面壳与 HTTP 服务共用。
//!
//! 为什么需要：`commands.rs` 里的实现是「命令 + 逻辑」写在一起的，
//! 逻辑本身（端口采样缓存、dev server 组装、进程索引）跟 Tauri 没关系，
//! 但只有通过 IPC 才能触达。Web 模式要复用它们，就得在 HTTP 侧重写一遍，
//! 两套实现必然分叉（口径、缓存、排序、去重都会慢慢不一致）。
//!
//! 这里只做「纯数据组装」，不做任何权限判断、不碰 AppHandle。
//! 敏感操作（终止进程、打开路径）留在 Tauri 命令里，因为那需要用户交互确认。

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::ai::{self, AiProcess};
use crate::devserver::{self, DevServer};
use crate::ports::{self, PortEntry};
use crate::procs::{self, ProcInfo};

/// 端口采样短缓存。`list_ports` 与 `list_dev_servers` 在一次刷新里
/// 各要一份端口表，原先各起一次采集子进程；这里让同一刷新周期共享。
const PORTS_TTL: Duration = Duration::from_millis(400);

static PORTS_CACHE: Mutex<Option<(Instant, Vec<PortEntry>)>> = Mutex::new(None);

/// 取端口表（400ms 内复用上一次结果）。
pub fn cached_ports() -> Result<Vec<PortEntry>, String> {
    let mut guard = PORTS_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some((at, entries)) = guard.as_ref() {
        if at.elapsed() < PORTS_TTL {
            return Ok(entries.clone());
        }
    }
    let entries = ports::collect()?;
    *guard = Some((Instant::now(), entries.clone()));
    Ok(entries)
}

/// 构建 PID 索引（消除 O(n*m) 端口→进程扫描）。
pub fn pid_index(procs: Vec<ProcInfo>) -> HashMap<u32, ProcInfo> {
    procs.into_iter().map(|p| (p.pid, p)).collect()
}

/// 监听中的 TCP 端口 → 开发服务器列表。
///
/// 纯组装：命令行命中框架规则才入选，按端口升序去重。
/// 白名单登记（Tauri 侧）由调用方负责 —— 这是「展示过」与「允许操作」的边界。
pub fn collect_dev_servers(port_entries: &[PortEntry]) -> Vec<DevServer> {
    let procs = procs::snapshot_processes();
    let index = pid_index(procs);
    let mut servers = Vec::new();

    for entry in port_entries.iter().filter(|e| e.protocol == "TCP") {
        if !ports::is_listening(&entry.state) || entry.local_port == 0 {
            continue;
        }
        let Some(proc) = index.get(&entry.pid) else {
            continue;
        };
        let cmd_lower = proc.cmd_line.to_ascii_lowercase();
        let exe_name_lower = std::path::Path::new(&proc.exe_path)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let Some((framework, confidence)) =
            devserver::classify_dev_server(&cmd_lower, &exe_name_lower)
        else {
            continue;
        };
        // 用结构化 argv 而不是把 cmd_line 按空格重切：含空格的路径会被切碎，
        // 推出一个不存在的相对目录并被登记进白名单。
        let project_dir = devserver::guess_project_dir(&proc.argv, &proc.exe_path, &proc.cwd);
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
    servers.sort_by_key(|s| s.port);
    servers.dedup_by_key(|s| s.port);
    servers
}

/// 一次快照：进程 + 端口 + 开发服务器，供 UI 首屏与 REST 消费者一次拿全。
pub struct RuntimeSnapshot {
    pub procs: Vec<ProcInfo>,
    pub ports: Vec<PortEntry>,
    pub dev_servers: Vec<DevServer>,
}

impl RuntimeSnapshot {
    pub fn capture() -> Result<Self, String> {
        let ports = cached_ports()?;
        let procs = procs::snapshot_processes();
        let dev_servers = collect_dev_servers(&ports);
        Ok(Self {
            procs,
            ports,
            dev_servers,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pid_index_maps_by_pid() {
        let procs = procs::snapshot_processes();
        let index = pid_index(procs.clone());
        assert_eq!(index.len(), procs.len());
        for p in &procs {
            assert_eq!(index.get(&p.pid).map(|x| x.pid), Some(p.pid));
        }
    }

    /// 缓存必须在 TTL 内复用同一份数据：两次调用返回相同结果，
    /// 且不会因为中间进程表变化而产生两份不同的快照。
    #[test]
    fn cached_ports_reuses_within_ttl() {
        let first = cached_ports().expect("ports should collect");
        let second = cached_ports().expect("ports should collect");
        assert_eq!(first.len(), second.len());
        assert!(first
            .iter()
            .zip(&second)
            .all(|(a, b)| a.local_port == b.local_port));
    }

    /// 空端口表不应 panic，也不应产出任何服务器。
    #[test]
    fn collect_dev_servers_handles_empty_input() {
        assert!(collect_dev_servers(&[]).is_empty());
    }
}

/// AI 编码进程（Claude Code / Codex / opencode 等）。
///
/// 与 `list_ai_processes` 命令同一套匹配规则：名称、命令行、可执行路径三处任一命中。
pub fn collect_ai_processes() -> Vec<AiProcess> {
    let mut out = Vec::new();
    for p in procs::snapshot_processes() {
        let name_lower = p.name.to_ascii_lowercase();
        let cmd_lower = p.cmd_line.to_ascii_lowercase();
        let exe_lower = p.exe_path.to_ascii_lowercase();
        let Some(kw) = ai::find_ai_keyword(&name_lower, &cmd_lower, &exe_lower) else {
            continue;
        };
        out.push(AiProcess {
            pid: p.pid,
            name: p.name.clone(),
            exe_path: p.exe_path.clone(),
            cmd_line: p.cmd_line.clone(),
            matched: kw.to_string(),
            memory: p.memory,
            start_time: p.start_time,
        });
    }
    out.sort_by_key(|a| a.name.clone());
    out
}

/// opencode 候选端口：默认 4096 + AI 进程命令行里的 `--port`。
///
/// 抽出来是因为端口发现逻辑被 IPC 与 HTTP 两处用到；写两份迟早会漏掉
/// `--port=NNNN` 与 `--port NNNN` 其中一种写法。
pub fn collect_opencode_ports(procs: &[ProcInfo]) -> Vec<u16> {
    let mut ports = vec![4096u16];
    for p in procs {
        let hay = p.cmd_line.to_ascii_lowercase();
        let name = p.name.to_ascii_lowercase();
        let exe = p.exe_path.to_ascii_lowercase();
        if !name.contains("opencode") && !exe.contains("opencode") {
            continue;
        }
        let tokens: Vec<&str> = hay.split_whitespace().collect();
        for (i, t) in tokens.iter().enumerate() {
            if let Some(rest) = t.strip_prefix("--port=") {
                if let Ok(v) = rest.parse::<u16>() {
                    ports.push(v);
                }
            } else if (*t == "--port" || *t == "-p") && i + 1 < tokens.len() {
                if let Ok(v) = tokens[i + 1].parse::<u16>() {
                    ports.push(v);
                }
            }
        }
    }
    ports.sort_unstable();
    ports.dedup();
    ports
}

#[cfg(test)]
mod ai_tests {
    use super::*;

    /// 匹配规则必须对三类入口一致：只改名称 / 只改命令行 / 只改路径都能命中。
    #[test]
    fn ai_keyword_matches_name_or_cmdline_or_exe() {
        // 直接测关键字函数本身，避免依赖真实进程表
        assert!(ai::find_ai_keyword("claude", "", "").is_some());
        assert!(ai::find_ai_keyword("", "codex exec", "").is_some());
        assert!(ai::find_ai_keyword("", "", "c:/x/opencode.exe").is_some());
        assert!(ai::find_ai_keyword("node", "node server.js", "c:/node.exe").is_none());
    }
}
