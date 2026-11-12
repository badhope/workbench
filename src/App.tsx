import { Suspense, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useStore } from "./lib/store";
import { useShallow } from "zustand/react/shallow";
import { useT } from "./lib/i18n";
import { AppHeader, DockHeader } from "./components/AppHeader";
import { KillDialog, Toast } from "./components/KillDialog";
import { CommandPalette } from "./components/CommandPalette";
import { TaskDetail } from "./components/TaskDetail";
import { OnboardingOverlay } from "./components/OnboardingOverlay";
import { ParticleBackdrop } from "./components/ParticleBackdrop";
import { BackgroundImage } from "./components/BackgroundImage";
import { Sidebar } from "./components/Nav";
import { Spinner } from "./ui";
import { PAGE_COMPONENTS } from "./pages/registry";
import { useBreakpoint } from "./lib/useBreakpoint";
import { useAppRuntime } from "./lib/useAppRuntime";
import { effectiveMotion } from "./lib/store";
import { applyMotion } from "./lib/theme/apply";
import { findTheme } from "./lib/theme/presets";
import { shellLayout } from "./lib/useShellLayout";
import { installGlobalDiagnostics, setViewResolver } from "./lib/diagnostics";
import type { ViewKey } from "./types";

/** 当前视图的页面组件。注册表由 pages/registry 统一维护。 */
function CurrentPage({ view }: { view: keyof typeof PAGE_COMPONENTS }) {
  const Page = PAGE_COMPONENTS[view];
  return <Page />;
}

export default function App() {
  const t = useT();
  const bp = useBreakpoint();
  // 侧边栏折叠（桌面/平板）与抽屉（窄屏）是两套状态：
  // 折叠是用户偏好，抽屉是临时交互，混用一个布尔会在跨断点时表现错乱。
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { view, setView, shell, motion, motionExplicit, backgroundImage } = useStore(
    useShallow((s) => ({
      view: s.view,
      setView: s.setView,
      shell: s.shell,
      motion: s.motion,
      motionExplicit: s.motionExplicit,
      backgroundImage: s.backgroundImage,
    }))
  );

  useAppRuntime();

  // 全局错误钩子只装一次：ErrorBoundary 只管渲染期异常，事件回调、
  // 定时器、未处理的 Promise 拒绝都会绕过它直接冒到 window。
  // 不装的话这些异常在生产里完全无声，用户只能说"它坏了"。
  useEffect(() => installGlobalDiagnostics(), []);

  // 让诊断记录带上当前页面，排障时能立刻知道是哪个页面炸的。
  useEffect(() => {
    setViewResolver(() => useStore.getState().view);
  }, []);

  // 动效档位变化（含首启引导里选的档）→ 立即落到 <html data-motion>。
  // main.tsx 启动时也写过一次；这里覆盖「运行中改档位」的路径。
  useEffect(() => {
    applyMotion(effectiveMotion({ motion, motionExplicit }));
  }, [motion, motionExplicit]);

  /**
   * 视图切换：standard/rich 档用 View Transitions 包一层（旧页淡出、新页就位），
   * off 档或不支持 startViewTransition 的 WebView 直接瞬时切换。
   * flushSync 让 React 的 DOM 提交落在过渡回调内部，否则截图的是切换前的 DOM。
   */
  const changeView = (k: ViewKey) => {
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => unknown;
    };
    if (
      document.documentElement.dataset.motion !== "off" &&
      typeof doc.startViewTransition === "function"
    ) {
      doc.startViewTransition(() => flushSync(() => setView(k)));
    } else {
      setView(k);
    }
  };

  const layout = shellLayout(bp, shell, collapsed);
  // 网格强度来自主题数据（不是读 DOM）：主题里 grid=0 时完全不铺网格。
  const gridStrength = useStore(
    useShallow((s) => findTheme(s.theme, s.customThemes).grid)
  );
  const showGrid = gridStrength > 0;

  return (
    <div className="flex h-full overflow-hidden bg-bg text-text">
      {/* 窄屏遮罩：抽屉打开时点击关闭 */}
      {bp === "compact" && drawerOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-[1px]"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {layout.showRail && (
        <Sidebar
          collapsed={layout.railCollapsed}
          compact={bp === "compact"}
          drawerOpen={drawerOpen}
          view={view}
          onPick={(k) => {
            changeView(k);
            setDrawerOpen(false);
          }}
          onToggleCollapse={() => setCollapsed(!collapsed)}
          onCloseDrawer={() => setDrawerOpen(false)}
        />
      )}

      {/* 内容列必须显式 z-10：背景图层（fixed z-0，DOM 靠后）按画家算法
          会盖过 z-auto 的 relative 兄弟——实测壁纸直接糊在正文上。
          侧栏自带 z-40 幸免，这里把内容列也提到壁纸之上。 */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        {layout.dock ? (
          <DockHeader view={view} onPick={changeView} />
        ) : (
          <AppHeader
            compact={bp === "compact"}
            onOpenDrawer={() => setDrawerOpen(true)}
          />
        )}

        <main
          key={view}
          className={`relative flex-1 overflow-auto animate-in ${
            bp === "compact" ? "p-3" : "px-6 py-5"
          }`}
        >
          {/* 底板网格：纯装饰，位于内容之下；强度由主题的 --grid-strength 控制 */}
          {showGrid && (
            <div
              className="grid-field pointer-events-none absolute inset-0"
              style={{ opacity: Math.min(1, gridStrength) }}
              aria-hidden="true"
            />
          )}
          <div
            className={`relative mx-auto flex min-h-full flex-col ${
              layout.narrowContent ? "max-w-[1080px]" : "w-full"
            }`}
          >
            <Suspense
              fallback={
                <div className="flex h-64 items-center justify-center gap-3 text-sm text-dim">
                  <Spinner /> {t("app.loading")}
                </div>
              }
            >
              <CurrentPage view={view} />
            </Suspense>
          </div>
        </main>
      </div>

      <KillDialog />
      <CommandPalette />
      <TaskDetail />
      <BackgroundImage dataUrl={backgroundImage} />
      <ParticleBackdrop />
      <OnboardingOverlay />
      <Toast />
    </div>
  );
}
