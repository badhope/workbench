import ReactDOM from "react-dom/client";
import App from "./App";
import MiniWorkbench from "./components/MiniWorkbench";
import { ErrorBoundary } from "./ErrorBoundary";
import "./styles/global.css";
import { useStore, effectiveMotion, flushPendingSave } from "./lib/store";
import { t, syncDocumentLang } from "./lib/i18n";
import { applyMotion, applyTheme } from "./lib/theme/apply";
import { tokensFor } from "./lib/theme/presets";
import { consumeThemeHash } from "./lib/theme/share";
import { detectTransport } from "./lib/transport";

// 分享链接：URL 带 #theme= 时先消费掉（一次性，成功与否都清 hash），
// 再做主题同步 —— 这样下面这行 applyTheme 应用的已经是导入后的主题。
// 先启动传输探测（不阻塞渲染）：浏览器里判断是「连了 HTTP 后端」还是纯静态预览，
// 结果一到就广播，模式徽章随之从占位值切到真实值。
void detectTransport();

const shared = consumeThemeHash();
if (shared) {
  const res = useStore.getState().importTheme(JSON.stringify(shared));
  const s = useStore.getState();
  s.setToast(res.ok ? t("settings.themeImported") : (res.error ?? ""));
}

// 启动时把持久化的主题 / 外壳 / 布局同步到 <html>
const boot = useStore.getState();
applyTheme(tokensFor(boot.theme, boot.customThemes), boot.shell, boot.layout);
// 动效档位也要在首帧就位：晚一帧的话首屏动画会按「无档位」跑
applyMotion(effectiveMotion(boot));
syncDocumentLang();

const isMini =
  new URLSearchParams(window.location.search).get("mini") === "1" ||
  (window as Window & { __WORKBENCH_MINI__?: boolean }).__WORKBENCH_MINI__ === true;

// 退出前 flush 待保存数据。
//
// 前端保存是 300ms 防抖，`app.exit(0)` 不会等异步请求。桌面端在退出前
// 发 `workbench://quit-requested` 事件，这里 flush 完再调 `quit_app`
// 真正退出；浏览器用 `pagehide` 兜底（刷新同样会丢防抖窗口内的编辑）。
const w = window as Window & { __workbenchFlush?: () => Promise<void> };
w.__workbenchFlush = flushPendingSave;
window.addEventListener("pagehide", () => {
  void flushPendingSave();
});

if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  void import("@tauri-apps/api/event").then(({ listen }) =>
    listen("workbench://quit-requested", async () => {
      await flushPendingSave();
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("quit_app").catch(() => undefined);
    })
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    {isMini ? <MiniWorkbench /> : <App />}
  </ErrorBoundary>
);
