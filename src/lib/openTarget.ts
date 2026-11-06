/**
 * 打开目标（URL / 本地目录）的分类纯函数。
 *
 * 独立成模块的原因：这段判定曾经写死在 api.ts 的 openExternal 里，
 * 用 `/^[a-z][a-z0-9+.-]*:/` 判 scheme，结果把 `C:\proj`、`C:/proj`
 * 这类 Windows 盘符路径也当成 scheme 拒绝，项目页和服务器页的「打开目录」
 * 全部失效（且是未处理的 Promise rejection，界面上毫无反应）。判定逻辑
 * 必须有单测覆盖各种路径形态。
 */

export type OpenTarget =
  /** http/https，交给系统浏览器 */
  | { kind: "http"; value: string }
  /** 其它 scheme（file:、ms-msdt: 等）：一律拒绝，不让系统默认处理器接管 */
  | { kind: "unsupported"; scheme: string }
  /** 本地路径，必须经过后端白名单校验 */
  | { kind: "path"; value: string }
  | { kind: "empty" };

/**
 * 是否为「真正的 URL scheme」而不是 Windows 盘符路径。
 *
 * `C:\proj` / `C:/proj` / 裸 `C:` / UNC `\\server\share` 都是路径。
 * 真正的 scheme 至少两个字符（`http:`、`mailto:`、`ms-msdt:`）。
 */
export function isUrlScheme(value: string): boolean {
  if (/^[a-zA-Z]:[\\/]/.test(value)) return false; // C:\ 或 C:/
  if (/^[a-zA-Z]:$/.test(value)) return false; // 裸盘符 C:
  if (/^\\\\|^\/\//.test(value)) return false; // UNC \\server\share 与 //server/share
  return /^[a-z][a-z0-9+.-]+:/i.test(value);
}

export function classifyOpenTarget(raw: string): OpenTarget {
  const value = raw.trim();
  if (!value) return { kind: "empty" };
  if (/^https?:\/\//i.test(value)) return { kind: "http", value };
  if (isUrlScheme(value)) {
    return { kind: "unsupported", scheme: value.split(":")[0] };
  }
  return { kind: "path", value };
}

/**
 * 把一个监听端口变成「值得尝试打开的 URL」。
 *
 * 为什么不能直接拼 `http://localhost:PORT`：
 * - 服务可能只监听 IPv6 或某个具体网卡，`localhost` 会解析到另一个协议栈；
 * - 也可能是 HTTPS（自签证书）、或压根不是 HTTP（数据库、SSH、Redis）。
 *   对后一类"打开"只会得到浏览器的 ERR_CONNECTION_RESET，比不提供更糟。
 *
 * 这里只做**保守推断**：监听在回环地址上才用 localhost，否则用 original
 * 地址；端口落在常见 HTTPS 端口上用 https。真正的可达性由调用方探测后决定
 * （见 `probeReachable`），不做无根据的断言。
 */
export function urlForPort(
  port: number,
  localAddr: string,
  protocol: string
): { url: string; likelyHttp: boolean } | null {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  // UDP 端口没有「打开网页」这一说
  if (protocol.toUpperCase() !== "TCP") return null;

  const host =
    localAddr === "0.0.0.0" || localAddr === "::" || localAddr === ""
      ? "localhost"
      : localAddr.includes(":")
        ? `[${localAddr}]` // IPv6 字面量必须加方括号
        : localAddr;

  const scheme = TLS_PORTS.has(port) ? "https" : "http";
  // 443/8443 之外，非标准端口也可能是 HTTPS，但无法从元数据判断；
  // 因此「是否真的能打开」交给探测，不在这里猜。
  return { url: `${scheme}://${host}:${port}`, likelyHttp: true };
}

/** 常见 TLS 端口（仅用于选择 scheme 的默认值）。 */
const TLS_PORTS = new Set([443, 8443, 9443]);

/**
 * 探测 URL 是否可达（HEAD 优先，回退 GET）。
 *
 * 用途不是"验证服务健康"，而是"避免给用户一个点了必失败的链接"：
 * 非 HTTP 服务、需要认证、跨域拦截都会失败，此时界面应退化为复制地址。
 * 超时 1200ms：本机服务正常时远快于此，慢到这个程度基本就是不可用。
 */
export async function probeReachable(url: string, timeoutMs = 1200): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const head = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      mode: "no-cors",
    });
    // no-cors 下所有响应都是 opaque（status 0），能拿到响应就说明端口在应答
    return head.type === "opaque" || head.ok;
  } catch {
    try {
      const get = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        mode: "no-cors",
      });
      return get.type === "opaque" || get.ok;
    } catch {
      return false;
    }
  } finally {
    clearTimeout(timer);
  }
}
