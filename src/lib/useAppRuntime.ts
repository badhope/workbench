import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isBackend, isTauri } from "./api";
import { currentTransport, subscribeTransport } from "./transport";
import { useStore } from "./store";

/**
 * 应用级副作用：首屏加载、可见性驱动的轮询、ESC 关 toast。
 *
 * 从 App.tsx 抽出来的原因：App 的圈复杂度实测 18（红线 10），而这几段
 * 全是与渲染无关的订阅逻辑。抽走后 App 只剩「外壳 + 路由」。
 */
/** 订阅传输探测结果：探测完成后触发重渲染，让模式徽章从不正确的 demo 切到真实值。 */
export function useTransportMode() {
  return useSyncExternalStore(subscribeTransport, currentTransport, currentTransport);
}

export function useAppRuntime() {
  const loadAll = useStore((s) => s.loadAll);
  const refreshRuntime = useStore((s) => s.refreshRuntime);
  const refreshMs = useStore((s) => s.refreshMs);
  const toast = useStore((s) => s.toast);
  const clearToast = useStore((s) => s.clearToast);

  // 首屏：loadAll 内部已串行触发 refreshRuntime / refreshAi
  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // 置顶是持久化偏好，但窗口属性只活在当前进程里：重启后必须重新下发，
  // 否则图标显示「已置顶」而窗口其实没有——一个典型的假状态。
  useEffect(() => {
    if (!isTauri()) return;
    const on = useStore.getState().alwaysOnTop;
    if (on) void invoke("set_always_on_top", { on: true }).catch(() => {});
  }, []);

  // 轮询：窗口隐藏时暂停（看不见界面时继续采样纯属浪费电）。
  // Web 模式同样需要轮询——它连的是真实后端，数据会变。
  useEffect(() => {
    if (!isBackend()) return;
    return pollWhileVisible(refreshRuntime, refreshMs);
  }, [refreshMs, refreshRuntime]);

  // ESC 关闭 toast
  useEffect(() => {
    if (!toast) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearToast();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toast, clearToast]);
}

/** 可见时轮询、隐藏时停表；恢复可见立即补一次。 */
function pollWhileVisible(tick: () => void, intervalMs: number): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const start = () => {
    stop();
    timer = setInterval(tick, intervalMs);
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      start();
      tick();
    } else {
      stop();
    }
  };
  if (document.visibilityState === "visible") start();
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    stop();
  };
}
