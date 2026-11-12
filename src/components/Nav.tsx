import type { LucideIcon } from "lucide-react";
import { PAGE_GROUPS, pagesByGroup, type ViewKey } from "../pages/registry";
import { APP_VERSION, useT } from "../lib/i18n";
import { useTransportMode } from "../lib/useAppRuntime";
import { BrandMark } from "./BrandMark";
import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";

/**
 * 导航条目的两种形态。
 *
 * 抽出来的原因：现在有三种外壳（侧栏 / 顶部坞 / 专注），导航的「条目」是
 * 同一份数据与同一套激活语义，只有排布方向不同。复制三份必然漂移——
 * 例如某天给导航加了徽标，只改到其中一种外壳。
 */

function useNavModel(view: ViewKey, onPick: (k: ViewKey) => void) {
  const t = useT();
  const groups = pagesByGroup().map(({ group, pages }) => ({
    key: group,
    label: t(PAGE_GROUPS.find((g) => g.key === group)?.label ?? group),
    pages: pages.map((p) => ({
      key: p.key as ViewKey,
      icon: p.icon as LucideIcon,
      label: t(`app.nav.${p.key}`),
      active: view === p.key,
      pick: () => onPick(p.key as ViewKey),
    })),
  }));
  return groups;
}

/** 竖排导航（侧栏 / 专注条）。 */
export function VerticalNav({
  view,
  onPick,
  collapsed,
}: {
  view: ViewKey;
  onPick: (k: ViewKey) => void;
  collapsed: boolean;
}) {
  const groups = useNavModel(view, onPick);
  return (
    <nav className="flex-1 overflow-y-auto px-2 py-2" aria-label="Primary">
      {groups.map((g) => (
        <div key={g.key} className="mb-0.5">
          {collapsed ? (
            g.key !== "home" && (
              <div className="mx-2 my-2 border-t border-line/60" aria-hidden="true" />
            )
          ) : (
            <div className="px-2.5 pb-1 pt-2.5 text-[10px] font-medium tracking-[0.09em] text-faint">
              {g.label}
            </div>
          )}
          {g.pages.map((p) => (
            <button
              key={p.key}
              type="button"
              title={p.label}
              data-active={p.active}
              onClick={p.pick}
              className={`nav-item w-full text-left ${collapsed ? "justify-center px-0" : ""}`}
            >
              <p.icon
                size={15}
                strokeWidth={p.active ? 2 : 1.7}
                className={`shrink-0 ${p.active ? "text-accent" : ""}`}
              />
              {!collapsed && (
                <span className={`truncate ${p.active ? "font-medium" : ""}`}>
                  {p.label}
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

/** 横排导航（顶部坞）。 */
export function HorizontalNav({
  view,
  onPick,
}: {
  view: ViewKey;
  onPick: (k: ViewKey) => void;
}) {
  const groups = useNavModel(view, onPick);
  return (
    <nav
      className="flex min-w-0 items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="Primary"
    >
      {groups.map((g, gi) => (
        <div key={g.key} className="flex shrink-0 items-center gap-1">
          {gi > 0 && <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />}
          {g.pages.map((p) => (
            <button
              key={p.key}
              type="button"
              title={p.label}
              data-active={p.active}
              onClick={p.pick}
              className={`dock-item ${p.active ? "dock-item-active" : ""}`}
            >
              <p.icon size={14} strokeWidth={p.active ? 2 : 1.7} />
              <span className="whitespace-nowrap">{p.label}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

/** 品牌块。`compact` 只显示字形。 */
export function BrandBlock({ compact }: { compact: boolean }) {
  const t = useT();
  return (
    <div
      className={`flex min-w-0 items-center ${compact ? "justify-center" : "gap-2.5"}`}
    >
      <BrandMark
        className="h-[22px] w-[25px] shrink-0"
        gradient
        title={compact ? t("app.brand") : undefined}
      />
      {!compact && (
        <div className="min-w-0 leading-none">
          <div className="truncate text-[13px] font-semibold tracking-[-0.01em]">
            {t("app.brand")}
          </div>
          <div className="mt-1 truncate text-[10px] tracking-[0.08em] text-faint">
            {t("app.brandSub")}
          </div>
        </div>
      )}
    </div>
  );
}

/** 侧栏外壳：品牌块 + 分组导航 + 折叠开关 + 运行模式脚注。 */
export function Sidebar(props: {
  collapsed: boolean;
  compact: boolean;
  drawerOpen: boolean;
  view: ViewKey;
  onPick: (k: ViewKey) => void;
  onToggleCollapse: () => void;
  onCloseDrawer: () => void;
}) {
  const t = useT();
  return (
    <aside className={sideClass(props)}>
      <div className={headClass(props.collapsed)}>
        <BrandBlock compact={props.collapsed} />
        {props.compact && (
          <button
            type="button"
            className="ml-auto rounded p-1 text-dim hover:text-text"
            onClick={props.onCloseDrawer}
            aria-label={t("app.close")}
          >
            <X size={16} />
          </button>
        )}
      </div>

      <VerticalNav view={props.view} onPick={props.onPick} collapsed={props.collapsed} />

      {!props.compact && (
        <CollapseToggle collapsed={props.collapsed} onToggle={props.onToggleCollapse} />
      )}

      <div className={footClass(props.collapsed)}>
        {!props.collapsed && <AppFooter />}
      </div>
    </aside>
  );
}

/** 侧栏外框：窄屏是抽屉（位移显隐），桌面是固定宽度的栏。 */
function sideClass({
  compact,
  drawerOpen,
  collapsed,
}: {
  compact: boolean;
  drawerOpen: boolean;
  collapsed: boolean;
}): string {
  const base =
    "z-40 flex shrink-0 flex-col border-r border-line/80 bg-panel/95 transition-[width,transform] duration-200";
  if (compact) {
    return `${base} fixed inset-y-0 left-0 w-60 ${
      drawerOpen ? "translate-x-0" : "-translate-x-full"
    }`;
  }
  return `${base} ${collapsed ? "w-[56px]" : "w-[212px]"}`;
}

function headClass(collapsed: boolean): string {
  return `flex h-[52px] items-center border-b border-line/60 ${
    collapsed ? "justify-center px-0" : "px-4"
  }`;
}

function footClass(collapsed: boolean): string {
  return `border-t border-line/60 py-2 text-[10px] leading-relaxed text-faint ${
    collapsed ? "px-0 text-center" : "px-4"
  }`;
}

/** 折叠开关。只在非窄屏出现：抽屉模式没有「折叠」概念。 */
function CollapseToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const label = collapsed ? t("app.nav.expand") : t("app.nav.collapse");
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex h-9 items-center gap-2 border-t border-line/60 px-3 text-[11px] text-faint transition-colors hover:text-text"
      title={label}
    >
      {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
}

/** 侧栏脚注：运行模式 + 版本号。 */
function AppFooter() {
  const t = useT();
  const mode = useTransportMode();
  const live = mode !== "demo";
  return (
    <>
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-ok" : "bg-warn"}`} />
        {mode === "tauri"
          ? t("app.mode.desktop")
          : mode === "http"
            ? t("app.mode.web")
            : t("app.mode.browser")}
      </div>
      <div className="mt-0.5 opacity-70">
        {t("app.versionLine", { version: APP_VERSION })}
      </div>
    </>
  );
}
