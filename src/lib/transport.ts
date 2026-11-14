/**
 * 传输层：同一份前端代码，跑在 Tauri 桌面壳里时走 IPC，跑在浏览器里时走 HTTP。
 *
 * 为什么需要：产品有三种运行形态——桌面应用、`workbench serve` 起的前后端一体
 * 服务、以及纯静态 demo（用于文档页/离线演示）。原先 `api.ts` 直接调
 * `invoke()`，非 Tauri 环境下一律退化成 demo 数据，等于「浏览器里只能看假数据」。
 * 把传输抽出来之后，页面组件与 store 完全不需要知道自己跑在哪。
 *
 * 判定顺序：
 * 1. `__TAURI_INTERNALS__` 存在 → `tauri`
 * 2. `GET /api/health` 返回 ok → `http`
 * 3. 否则 → `demo`（静态演示数据）
 *
 * 探测是**一次性**的且带缓存：多个并发调用共享同一个 promise，
 * 避免首屏同时发 8 个请求时打 8 次健康检查。
 */

export type TransportMode = "tauri" | "http" | "demo";

let mode: TransportMode | null = null;
let detection: Promise<TransportMode> | null = null;
let resolved = false;
const listeners = new Set<() => void>();

/** API 基址。同源部署时为空串；可用 `VITE_API_BASE` 指到别的端口。 */
const API_BASE = (import.meta.env?.VITE_API_BASE as string | undefined) ?? "";

function detectTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * 探测后端。只探一次，结果缓存。
 *
 * 超时 1500ms：静态站点被访问时 `/api/health` 会 404（很快），
 * 但如果是被错误配置到一个黑洞地址，用户不该等 30 秒才看到页面。
 */
export function detectTransport(): Promise<TransportMode> {
  if (detection) return detection;
  if (detectTauri()) {
    mode = "tauri";
    detection = Promise.resolve(mode);
    return detection;
  }
  detection = (async (): Promise<TransportMode> => {
    let next: TransportMode = "demo";
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${API_BASE}/api/health`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      clearTimeout(timer);
      if (res.ok) {
        const body: unknown = await res.json();
        if (
          body &&
          typeof body === "object" &&
          (body as { status?: unknown }).status === "ok"
        ) {
          next = "http";
        }
      }
    } catch {
      // 网络错误 / 超时 / 非 JSON：都退化为静态演示
    }
    mode = next;
    resolved = true;
    // 探测结果必须广播：组件首帧渲染时探测还没回来，读到的是 "demo"，
    // 不通知的话「Web · 真实数据」这个状态永远不会出现，界面一直显示演示。
    for (const fn of listeners) fn();
    return next;
  })();
  return detection;
}

/** 已探测到的模式；未探测时按环境粗判（Tauri 判定无需网络）。 */
export function currentTransport(): TransportMode {
  if (mode) return mode;
  if (detectTauri()) mode = "tauri";
  return mode ?? "demo";
}

/** 探测是否已经完成（用于区分「未知」与「确认为 demo」）。 */
export function transportResolved(): boolean {
  return resolved || detectTauri();
}

/** 订阅探测结果变化。 */
export function subscribeTransport(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 是否连得上真实后端（桌面或 HTTP 服务）。 */
export function hasBackend(): boolean {
  const m = currentTransport();
  return m === "tauri" || m === "http";
}

/** 是否桌面壳（托盘、置顶、系统通知等能力只在这里有）。 */
export function isDesktop(): boolean {
  return currentTransport() === "tauri";
}

/** 仅供测试：重置探测状态。 */
export function __resetTransportForTests(): void {
  mode = null;
  detection = null;
  resolved = false;
  listeners.clear();
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** 统一的 fetch 封装：JSON 编解码 + 错误归一化。
 * `headers` 用于传递 `If-Match` 之类的条件请求头；
 * `write: true` 自动带写入标记头（后端用它挡住跨源写请求）。 */
export async function httpJson<T>(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    write?: boolean;
  } = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      accept: "application/json",
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...(init.write ? { "x-workbench-write": "1" } : {}),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) {
    // 后端错误统一是 {"error": "..."}；解析失败时退回状态码文本，
    // 避免把 HTML 错误页整段丢进 toast。
    let message = `HTTP ${res.status}`;
    try {
      const body: unknown = await res.json();
      if (body && typeof body === "object") {
        const err = (body as { error?: unknown }).error;
        if (typeof err === "string" && err.trim()) message = err;
      }
    } catch {
      // 保持状态码文本
    }
    throw new HttpError(message, res.status);
  }
  return (await res.json()) as T;
}
