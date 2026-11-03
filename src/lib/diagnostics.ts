/**
 * 前端诊断缓冲。
 *
 * 为什么需要：产品是本地优先的桌面应用，没有服务端日志、没有崩溃上报，
 * 一旦出问题，用户能给维护者的只有"它坏了"三个字。Rust 侧有写文件的
 * 日志，但渲染进程的异常落在 DevTools 里——普通用户不会打开它，关掉窗口
 * 就永久消失。
 *
 * 这里做三件事，都只在本机内存 + localStorage 里，不外发：
 * 1. 捕获全局 `error` / `unhandledrejection`（ErrorBoundary 抓不到它们：
 *    边界只处理"渲染期间抛出的异常"，事件回调、定时器、异步链里的异常
 *    会直接冒到 window）。
 * 2. 保留最近 N 条，附带时间、来源、堆栈，供「诊断」页展示与一键复制。
 * 3. 给每条一个可读的短 id，用户报障时可以只念这个 id。
 */

const MAX_ENTRIES = 50;
const STORAGE_KEY = "workbench-diagnostics-v1";

export type DiagnosticKind = "error" | "rejection" | "render" | "warn";

export interface DiagnosticEntry {
  id: string;
  at: string;
  kind: DiagnosticKind;
  message: string;
  stack?: string;
  /** 出错时所在的页面（导航状态），帮助判断是哪个页面炸的 */
  view?: string;
}

let entries: DiagnosticEntry[] = [];
const listeners = new Set<() => void>();
let sequence = 0;
/** 由 App 注入：读当前页面，避免把 store 依赖引进这个纯工具模块 */
let viewResolver: (() => string) | undefined;

export function setViewResolver(fn: () => string): void {
  viewResolver = fn;
}

function nextId(): string {
  sequence += 1;
  return `E${String(sequence).padStart(3, "0")}`;
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // 隐私模式 / 配额满：内存里仍然可用，不影响功能
  }
}

function restore(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    entries = parsed.filter(
      (e): e is DiagnosticEntry =>
        Boolean(e) &&
        typeof e === "object" &&
        typeof (e as DiagnosticEntry).message === "string"
    );
    // 恢复后继续递增，避免新 id 与历史撞号
    sequence = entries.length;
  } catch {
    entries = [];
  }
}

restore();

function notify(): void {
  for (const fn of listeners) fn();
}

/** 记录一条。`message` 为空时不记，避免满屏 "undefined"。 */
export function recordDiagnostic(
  kind: DiagnosticKind,
  message: string,
  stack?: string
): DiagnosticEntry | null {
  const text = (message ?? "").trim();
  if (!text) return null;
  // 同一条错误连续出现（例如每秒刷新的图表重复抛错）只留一条，
  // 否则 50 条容量三秒就被同一句话占满，真正有用的历史被挤掉。
  const last = entries[0];
  if (last && last.message === text && last.kind === kind) return last;

  const entry: DiagnosticEntry = {
    id: nextId(),
    at: new Date().toISOString(),
    kind,
    message: text,
    stack,
    view: viewResolver?.(),
  };
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  persist();
  notify();
  return entry;
}

export function getDiagnostics(): DiagnosticEntry[] {
  return entries;
}

export function clearDiagnostics(): void {
  entries = [];
  persist();
  notify();
}

export function subscribeDiagnostics(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 纯文本报告：给「复制诊断信息」按钮用，粘贴进 issue 就能看。 */
export function diagnosticsReport(): string {
  if (entries.length === 0) return "（无前端错误记录）";
  return entries
    .map((e) => {
      const head = `[${e.id}] ${e.at} ${e.kind}${e.view ? ` @${e.view}` : ""}`;
      const body = e.stack ? `${e.message}\n${e.stack}` : e.message;
      return `${head}\n${body}`;
    })
    .join("\n\n---\n\n");
}

/**
 * 安装全局钩子。返回卸载函数（测试里需要，生产只装一次）。
 *
 * 注意 `console.error` 不拦：React 等库会用它输出非致命的告警，
 * 全量接管会把正常信息也记成错误，反而淹没真正的异常。
 */
export function installGlobalDiagnostics(): () => void {
  if (typeof window === "undefined") return () => {};

  const onError = (event: ErrorEvent) => {
    recordDiagnostic(
      "error",
      event.message || String(event.error ?? "unknown error"),
      event.error instanceof Error ? event.error.stack : undefined
    );
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : (() => {
              try {
                return JSON.stringify(reason);
              } catch {
                return String(reason);
              }
            })();
    recordDiagnostic(
      "rejection",
      `Unhandled rejection: ${message}`,
      reason instanceof Error ? reason.stack : undefined
    );
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
