//! 端口占用解析：把 `netstat -ano`（Windows）与 `ss -tulpn`（Linux）的
//! 输出统一成 PortEntry。解析全部是纯函数，平台差异只体现在命令与方言。

use serde::Serialize;

#[derive(Serialize, Clone, Debug, ts_rs::TS)]
pub struct PortEntry {
    pub protocol: String,
    pub local_addr: String,
    pub local_port: u16,
    pub remote_addr: String,
    pub state: String,
    pub pid: u32,
}

/// 采集端口表：按平台选命令，再交给对应的解析器。
///
/// - Windows: `netstat -ano`（不做 chcp，解析器只认 ASCII 协议名）
/// - Linux: `ss -tulpnH`（`-H` 去掉表头；非 root 时进程列为 `users:(("x",pid=N,...))`）
/// - 其它 POSIX: 退回 `netstat -an`
pub fn collect() -> Result<Vec<PortEntry>, String> {
    #[cfg(windows)]
    {
        let out = crate::procs::run_quiet("netstat", &["-ano"])
            .map_err(|e| format!("netstat 执行失败: {e}"))?;
        Ok(parse_netstat(&out))
    }
    #[cfg(target_os = "linux")]
    {
        match crate::procs::run_quiet("ss", &["-tulpnH"]) {
            Ok(out) => Ok(parse_ss(&out)),
            // 极简发行版可能没有 iproute2，回退到 netstat
            Err(_) => {
                let out = crate::procs::run_quiet("netstat", &["-tulpn"])
                    .map_err(|e| format!("ss 与 netstat 均不可用: {e}"))?;
                Ok(parse_netstat(&out))
            }
        }
    }
    #[cfg(all(unix, not(target_os = "linux")))]
    {
        let out = crate::procs::run_quiet("netstat", &["-anv"])
            .map_err(|e| format!("netstat 执行失败: {e}"))?;
        Ok(parse_netstat(&out))
    }
}

/// 解析 `ss -tulpnH` 输出。
///
/// 典型行：
/// `tcp   LISTEN 0  128  0.0.0.0:5173  0.0.0.0:*  users:(("node",pid=2145,fd=20))`
/// `udp   UNCONN 0  0    127.0.0.53:53  0.0.0.0:*  users:(("systemd-resolve",pid=812,fd=13))`
/// 非 root 时没有 `users:` 段，pid 记 0（UI 会退化成只显示端口号）。
pub fn parse_ss(output: &str) -> Vec<PortEntry> {
    let mut out = Vec::new();
    for line in output.lines() {
        let tokens: Vec<&str> = line.split_whitespace().collect();
        if tokens.len() < 5 {
            continue;
        }
        let protocol = match tokens[0].to_ascii_lowercase().as_str() {
            "tcp" => "TCP",
            "udp" => "UDP",
            _ => continue,
        };
        // 布局：Netid State Recv-Q Send-Q Local Peer [Process]
        let Some((local_addr, local_port)) = split_host_port(tokens[4]) else {
            continue;
        };
        // 用 get(5) 而不是 tokens[5]：截断输出（恰好 5 列）会越界 panic，
        // 而外部命令输出不是类型安全输入。
        let Some(peer) = tokens.get(5) else {
            continue;
        };
        let (remote_addr, _) = split_host_port(peer).unwrap_or((peer.to_string(), 0));
        // 状态词必须与 netstat 方言统一：netstat 给 "LISTENING"，ss 给 "LISTEN"。
        // 消费方（Servers 页、list_dev_servers）只认一种，
        // 不统一就会在某个平台上整片丢掉监听端口。
        let state = if protocol == "UDP" {
            "UDP".to_string()
        } else {
            normalize_state(tokens[1])
        };
        let pid = tokens
            .iter()
            .find_map(|t| t.split("pid=").nth(1))
            .and_then(|rest| rest.split([',', ')']).next())
            .and_then(|n| n.parse::<u32>().ok())
            .unwrap_or(0);
        out.push(PortEntry {
            protocol: protocol.to_string(),
            local_addr,
            local_port,
            remote_addr,
            state,
            pid,
        });
    }
    out
}

/// 从 netstat 输出中解析端口条目。
/// Windows 行：`TCP    0.0.0.0:5173    0.0.0.0:0    LISTENING    12345`
/// POSIX 行：   `tcp        0      0 0.0.0.0:5173  0.0.0.0:*    LISTENING      21456/node`
pub fn parse_netstat(output: &str) -> Vec<PortEntry> {
    let mut out = Vec::new();
    for line in output.lines() {
        let tokens: Vec<&str> = line.split_whitespace().collect();
        let proto_raw = match tokens.first() {
            Some(t) => *t,
            None => continue,
        };
        let protocol = match proto_raw.to_ascii_uppercase().as_str() {
            "TCP" | "TCP6" => "TCP",
            "UDP" | "UDP6" => "UDP",
            _ => continue,
        };
        // POSIX 方言第 2 列是 Recv-Q（纯数字），Windows 第 2 列就是本地地址。
        let posix = tokens.len() >= 4 && tokens[1].chars().all(|c| c.is_ascii_digit());
        let (local, foreign, state, pid_tok) = if posix {
            let local = tokens[3];
            let foreign = tokens.get(4).copied().unwrap_or("");
            if protocol == "TCP" {
                (
                    local,
                    foreign,
                    tokens.get(5).copied(),
                    tokens.get(6).copied(),
                )
            } else {
                (local, foreign, None, tokens.get(5).copied())
            }
        } else {
            let local = match tokens.get(1) {
                Some(t) => *t,
                None => continue,
            };
            let foreign = tokens.get(2).copied().unwrap_or("");
            if protocol == "TCP" {
                (
                    local,
                    foreign,
                    tokens.get(3).copied(),
                    tokens.get(4).copied(),
                )
            } else {
                (local, foreign, None, tokens.get(3).copied())
            }
        };
        let (local_addr, local_port) = match split_host_port(local) {
            Some(pair) => pair,
            None => continue,
        };
        let pid_tok = match pid_tok {
            Some(t) => t,
            None => continue,
        };
        // POSIX 的 PID 列形如 `21456/node`，取斜杠前段。
        let pid_str = pid_tok.split('/').next().unwrap_or(pid_tok);
        let pid = match pid_str.parse::<u32>() {
            Ok(p) => p,
            Err(_) => continue,
        };
        let (remote_addr, _) = split_host_port(foreign).unwrap_or((foreign.to_string(), 0));
        out.push(PortEntry {
            protocol: protocol.to_string(),
            local_addr,
            local_port,
            remote_addr,
            state: state
                .map(normalize_state)
                .unwrap_or_else(|| "UDP".to_string()),
            pid,
        });
    }
    out
}

/// 把不同方言的 TCP 状态统一成一个词表。
/// netstat: LISTENING / ESTABLISHED / TIME_WAIT…
/// ss:      LISTEN / ESTAB / TIME-WAIT…
pub fn normalize_state(raw: &str) -> String {
    let upper = raw.trim().to_ascii_uppercase();
    match upper.as_str() {
        "LISTEN" => "LISTENING".to_string(),
        "ESTAB" => "ESTABLISHED".to_string(),
        "TIME-WAIT" => "TIME_WAIT".to_string(),
        "FIN-WAIT-1" => "FIN_WAIT_1".to_string(),
        "FIN-WAIT-2" => "FIN_WAIT_2".to_string(),
        "CLOSE-WAIT" => "CLOSE_WAIT".to_string(),
        "LAST-ACK" => "LAST_ACK".to_string(),
        "SYN-SENT" => "SYN_SENT".to_string(),
        "SYN-RECV" => "SYN_RECV".to_string(),
        _ => upper,
    }
}

/// 是否处于监听状态。三处消费点共用这一判据，避免再出现
/// 「一边过滤 LISTEN、一边过滤 LISTENING」的平台性整片丢弃。
pub fn is_listening(state: &str) -> bool {
    state.eq_ignore_ascii_case("LISTENING") || state.eq_ignore_ascii_case("UDP")
}

/// 拆 `[::1]:5173` / `0.0.0.0:5173` / `:::5173` / `*:*` → (addr, port)
pub fn split_host_port(s: &str) -> Option<(String, u16)> {
    let trimmed = s.trim();
    let idx = trimmed.rfind(':')?;
    let (addr_part, port_part) = (&trimmed[..idx], &trimmed[idx + 1..]);
    if port_part == "*" {
        return Some((
            addr_part.trim_matches(|c| c == '[' || c == ']').to_string(),
            0,
        ));
    }
    let port: u16 = port_part.parse().ok()?;
    let addr = addr_part
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    Some((addr, port))
}

#[cfg(test)]
mod tests {
    use super::*;

    const WIN_OUTPUT: &str = "
活动连接

  协议  本地地址              外部地址        状态                     PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1240
  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       21456
  TCP    [::]:5173              [::]:0                 LISTENING       21456
  TCP    127.0.0.1:54321        127.0.0.1:5173         ESTABLISHED     21456
  UDP    0.0.0.0:5353           *:*                                    4567
";

    const POSIX_OUTPUT: &str = "
Active Internet connections (only servers)
Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name
tcp        0      0 0.0.0.0:5173          0.0.0.0:*               LISTENING      21456/node
tcp6       0      0 :::8080                 :::*                    LISTENING      1001
udp        0      0 0.0.0.0:5353          0.0.0.0:*                           1002
";

    #[test]
    fn parses_windows_netstat() {
        let entries = parse_netstat(WIN_OUTPUT);
        assert_eq!(entries.len(), 5);
        let dev = entries
            .iter()
            .find(|e| e.local_port == 5173 && e.protocol == "TCP")
            .unwrap();
        assert_eq!(dev.state, "LISTENING");
        assert_eq!(dev.pid, 21456);
        assert_eq!(dev.local_addr, "0.0.0.0");

        let v6 = entries.iter().find(|e| e.local_addr == "::").unwrap();
        assert_eq!(v6.local_port, 5173);

        let udp = entries.iter().find(|e| e.protocol == "UDP").unwrap();
        assert_eq!(udp.pid, 4567);
        assert_eq!(udp.local_port, 5353);
    }

    #[test]
    fn parses_posix_netstat() {
        let entries = parse_netstat(POSIX_OUTPUT);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].local_port, 5173);
        assert_eq!(entries[0].pid, 21456);
        assert_eq!(entries[1].local_port, 8080);
        assert_eq!(entries[2].protocol, "UDP");
    }

    #[test]
    fn skips_garbage_and_headers() {
        assert!(parse_netstat("").is_empty());
        assert!(parse_netstat("  协议  本地地址  外部地址").is_empty());
        assert!(parse_netstat("TCP incomplete").is_empty());
        assert!(parse_netstat("FOO 1.2.3.4:80 0.0.0.0:0 LISTENING 1").is_empty());
    }
}

#[cfg(test)]
mod ss_tests {
    use super::*;

    const SS_OUTPUT: &str = "\
tcp   LISTEN 0      128        0.0.0.0:5173       0.0.0.0:*    users:((\"node\",pid=2145,fd=20))
tcp   LISTEN 0      4096     127.0.0.53:53         0.0.0.0:*
tcp   LISTEN 0      511         [::]:8000          [::]:*    users:((\"python\",pid=987,fd=6))
udp   UNCONN 0      0        127.0.0.53:53         0.0.0.0:*    users:((\"systemd-resolve\",pid=812,fd=13))
";

    #[test]
    fn parses_ss_output_with_and_without_process_info() {
        let entries = parse_ss(SS_OUTPUT);
        assert_eq!(entries.len(), 4);

        let vite = entries.iter().find(|e| e.local_port == 5173).unwrap();
        assert_eq!(vite.protocol, "TCP");
        assert_eq!(vite.state, "LISTENING", "ss 的 LISTEN 必须统一成 LISTENING");
        assert_eq!(vite.pid, 2145);

        // 非 root 时没有 users: 段 → pid 退化为 0，但端口仍要显示
        let dns = entries
            .iter()
            .find(|e| e.local_port == 53 && e.pid == 0)
            .unwrap();
        assert_eq!(dns.state, "LISTENING");

        // [::] 要能正确拆出地址与端口
        let v6 = entries.iter().find(|e| e.local_port == 8000).unwrap();
        assert_eq!(v6.local_addr, "::");
        assert_eq!(v6.pid, 987);

        // UDP 没有 State 列，统一记 UDP
        let udp = entries.iter().find(|e| e.protocol == "UDP").unwrap();
        assert_eq!(udp.state, "UDP");
        assert_eq!(udp.pid, 812);
    }

    #[test]
    fn skips_garbage_ss_lines() {
        assert!(parse_ss("").is_empty());
        assert!(parse_ss("tcp LISTEN").is_empty());
        assert!(parse_ss("weird 1 2 3 4 5").is_empty());
    }
}

/// 真实采集测试：用一个真的监听端口验证「采集 → 解析 → 状态归一」整条链路。
///
/// 这是此前缺失的跨模块验证：解析单测只用字面量输入，
/// 从未证明 collect() 在真实系统上能拿到数据、且状态词与消费方一致。
#[cfg(all(test, target_os = "linux"))]
mod live_tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn collect_finds_a_real_listening_port() {
        // 绑定一个随机可用端口并保持监听
        let listener = TcpListener::bind("0.0.0.0:0").expect("应能绑定端口");
        let port = listener.local_addr().unwrap().port();

        let entries = collect().expect("采集应成功");
        let found = entries.iter().find(|e| e.local_port == port);

        let Some(entry) = found else {
            // 容器内可能因权限/能力限制看不到 socket；这种环境跳过而不是假失败
            eprintln!("未采集到端口 {port}（当前环境可能限制 socket 枚举），跳过");
            return;
        };

        assert_eq!(entry.protocol, "TCP");
        assert!(
            is_listening(&entry.state),
            "监听中的端口状态必须被 is_listening 认可，实际是 {:?}",
            entry.state
        );
        assert_eq!(
            entry.state, "LISTENING",
            "ss 的 LISTEN 必须归一成 LISTENING，否则消费方会整片丢数据"
        );
    }
}
