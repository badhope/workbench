import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import "./styles/global.css";
import { useStore, effectiveMotion } from "./lib/store";
import { t, syncDocumentLang } from "./lib/i18n";
import { applyMotion, applyTheme } from "./lib/theme/apply";
import { tokensFor } from "./lib/theme/presets";
import { consumeThemeHash } from "./lib/theme/share";

// 分享链接：URL 带 #theme= 时先消费掉（一次性，成功与否都清 hash），
// 再做主题同步 —— 这样下面这行 applyTheme 应用的已经是导入后的主题。
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
