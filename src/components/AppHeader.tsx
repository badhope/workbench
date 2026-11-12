import { invoke } from "@tauri-apps/api/core";
import { Menu, Moon, PictureInPicture2, Pin, PinOff, RefreshCw, Search, Sun } from "lucide-react";
import { isTauri } from "../lib/api";
import { openMiniWindow } from "../lib/miniWindow";

import { localeFor, useLang, useT } from "../lib/i18n";
import { useStore } from "../lib/store";
import { useTransportMode } from "../lib/useAppRuntime";
import { useShallow } from "zustand/react/shallow";
import { allThemes, findTheme } from "../lib/theme/presets";
import { Btn, Spinner } from "../ui";
import { BrandBlock, HorizontalNav } from "./Nav";
import type { ViewKey } from "../pages/registry";

/**
 * 顶栏：标题 + 运行模式 + 右侧控制簇。
 *
 * 从 App.tsx 抽出来的原因：App 的圈复杂度实测 43（红线 10），
 * 而这部分全是「按钮 + 一个循环切主题」的独立逻辑，与页面路由无关。
 * 抽走后 App 只负责外壳与路由。
 */
/** 顶栏右侧控制簇。单独导出：顶部坞外壳只要它，不要标题。 */
export function AppHeaderControls() {
  const t = useT();
  const lang = useLang();
  const {
    theme,
    customThemes,
    setTheme,
    loading,
    lastRefreshAt,
    refreshRuntime,
    alwaysOnTop,
    setAlwaysOnTop,
  } = useStore(
    useShallow((s) => ({
      theme: s.theme,
      customThemes: s.customThemes,
      setTheme: s.setTheme,
      loading: s.loading,
      lastRefreshAt: s.lastRefreshAt,
      refreshRuntime: s.refreshRuntime,
      alwaysOnTop: s.alwaysOnTop,
      setAlwaysOnTop: s.setAlwaysOnTop,
    }))
  );
  const current = findTheme(theme, customThemes);
  const themes = allThemes(customThemes);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => {
          window.dispatchEvent(
            new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })
          );
        }}
        title={t("app.searchShortcut")}
        aria-label={t("app.searchShortcut")}
        className="hidden items-center gap-1.5 rounded-full border border-line/70 bg-panel2/60 px-2.5 py-1 text-[11px] text-dim transition-colors hover:text-text xl:flex"
      >
        <Search size={12} />
        <span className="max-w-[130px] truncate">{t("app.searchShortcut")}</span>
        <kbd className="rounded border border-line px-1 text-[9.5px] text-faint">
          Ctrl K
        </kbd>
      </button>
      <span className="num hidden text-[11px] text-faint lg:inline">
        {lastRefreshAt
          ? t("app.runtimeUpdatedAt", {
              time: new Date(lastRefreshAt).toLocaleTimeString(localeFor(lang), {
                hour12: false,
              }),
            })
          : t("app.waitingRefresh")}
      </span>
      {loading && <Spinner />}
      <div className="flex items-center gap-0.5 rounded-full border border-line/70 bg-panel2/60 p-0.5">
        <Btn
          title={t("mini.open")}
          onClick={() => void openMiniWindow()}
          className="!rounded-full !border-0 !bg-transparent !px-1.5 !py-1 !text-dim hover:!text-text"
        >
          <PictureInPicture2 size={13} />
        </Btn>
        <Btn
          title={t("app.refreshNow")}
          onClick={refreshRuntime}
          className="!rounded-full !border-0 !bg-transparent !px-1.5 !py-1 !text-dim hover:!text-text"
        >
          <RefreshCw size={13} />
        </Btn>
        {/* 置顶是窗口能力：Web 模式没有窗口可置顶，按钮直接不渲染，
            而不是留一个点了没反应的图标。 */}
        {isTauri() && (
          <Btn
            title={alwaysOnTop ? t("app.pinOn") : t("app.pinOff")}
            onClick={async () => {
              const next = !alwaysOnTop;
              setAlwaysOnTop(next);
              try {
                await invoke("set_always_on_top", { on: next });
              } catch {
                setAlwaysOnTop(!next);
              }
            }}
            className={`!rounded-full !border-0 !bg-transparent !px-1.5 !py-1 !text-dim hover:!text-text ${
              alwaysOnTop ? "!text-accent" : ""
            }`}
          >
            {alwaysOnTop ? <Pin size={13} /> : <PinOff size={13} />}
          </Btn>
        )}
        <Btn
          title={t("app.themeToggle")}
          onClick={() => {
            const idx = themes.findIndex((s) => s.id === theme);
            setTheme(themes[(idx + 1) % themes.length].id);
          }}
          className="!rounded-full !border-0 !bg-transparent !px-1.5 !py-1 !text-dim hover:!text-text"
        >
          {current.dark ? <Moon size={13} /> : <Sun size={13} />}
        </Btn>
      </div>
    </div>
  );
}

export function AppHeader({
  compact,
  onOpenDrawer,
}: {
  compact: boolean;
  onOpenDrawer: () => void;
}) {
  const t = useT();
  const { view } = useStore(useShallow((s) => ({ view: s.view })));
  // 三态：桌面实时 / 浏览器连后端实时 / 纯静态演示。
  // 少一态就会把「浏览器连着 serve」错标成 Demo，用户会以为数据是假的。
  const mode = useTransportMode();
  const live = mode !== "demo";
  const modeLabel =
    mode === "tauri"
      ? t("app.mode.realtime")
      : mode === "http"
        ? t("app.mode.web")
        : t("app.mode.demo");

  return (
    <header
      className={`flex h-[52px] shrink-0 items-center gap-3 border-b border-line/80 bg-panel/70 backdrop-blur-sm ${
        compact ? "px-3" : "px-6"
      }`}
      data-tauri-drag-region
    >
      {compact && (
        <Btn title={t("app.nav.menu")} onClick={onOpenDrawer} className="!px-2 !py-1">
          <Menu size={16} />
        </Btn>
      )}
      <h1 className="t-heading truncate text-[15px] font-semibold">
        {t(`app.title.${view}`)}
      </h1>
      <span
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-[3px] text-[10px] font-medium tracking-[0.02em] ${
          live ? "border-ok/30 bg-ok/8 text-ok" : "border-warn/30 bg-warn/8 text-warn"
        }`}
      >
        <span className={`h-1 w-1 rounded-full ${live ? "bg-ok" : "bg-warn"}`} />
        {modeLabel}
      </span>
      <div className="ml-auto">
        <AppHeaderControls />
      </div>
    </header>
  );
}

/** 顶部坞外壳的顶栏：品牌 + 横排导航 + 控制簇。 */
export function DockHeader({
  view,
  onPick,
}: {
  view: ViewKey;
  onPick: (k: ViewKey) => void;
}) {
  return (
    <header
      className="flex h-[52px] shrink-0 items-center gap-4 border-b border-line/80 bg-panel/70 px-4 backdrop-blur-sm"
      data-tauri-drag-region
    >
      <div className="flex shrink-0 items-center gap-2.5 pr-3">
        <BrandBlock compact={false} />
      </div>
      <HorizontalNav view={view} onPick={onPick} />
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <AppHeaderControls />
      </div>
    </header>
  );
}
