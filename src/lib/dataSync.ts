/**
 * 跨窗口数据变更通知。
 *
 * 主窗口与工作小窗是独立的 WebView，Zustand 内存互不相通；
 * 用小范围的 BroadcastChannel 只广播「数据变了」，由各窗口重新走
 * 现有的 loadAll()（它已有未保存/版本冲突保护），不复制数据快照。
 */
const CHANNEL = "workbench-data";

export function notifyDataChanged(): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage("changed");
    channel.close();
  } catch {
    /* 隐私模式或旧 WebView 不支持时静默降级 */
  }
}

export function subscribeDataChanged(callback: () => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => callback();
    return () => channel.close();
  } catch {
    return () => {};
  }
}
