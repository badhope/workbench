/**
 * 工作小窗入口。
 *
 * 桌面端由后端创建独立 Tauri 窗口；浏览器预览用 window.open 打开同一
 * `?mini=1` 页面，便于在没有桌面构建链时也能验收 UI 与数据交互。
 */
import { isTauri, openMiniWindow as openMiniWindowIpc } from "./api";

export function miniWindowUrl(): string {
  const url = new URL(window.location.href);
  url.searchParams.set("mini", "1");
  return url.toString();
}

export async function openMiniWindow(): Promise<void> {
  if (isTauri()) {
    try {
      await openMiniWindowIpc();
      return;
    } catch {
      // 桌面命令不可用时退回浏览器新窗口，至少不留下一个点了没反应的按钮。
    }
  }
  window.open(
    miniWindowUrl(),
    "workbench-mini",
    "popup=yes,width=380,height=580,resizable=yes,scrollbars=yes"
  );
}
