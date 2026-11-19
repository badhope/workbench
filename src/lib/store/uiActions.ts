import {
  BUILTIN_THEMES,
  DEFAULT_THEME_ID,
  allThemes,
  parseTheme,
  tokensFor,
} from "../theme/presets";
import { applyMotion, applyTheme } from "../theme/apply";
import {
  DEFAULT_ORDER,
  normalizeHidden,
  normalizeOrder,
  normalizeSpans,
} from "../layout";
import { t } from "../i18n";
import { DEFAULT_WORK_MODES, normalizeWorkModes } from "../workModes";
import {
  TOAST_TTL_MS,
  effectiveMotion,
  isBackgroundDataUrl,
  normalizeIntensity,
} from "./helpers";
import type { Store, StoreGet, StoreSet } from "./types";
import { sanitizeProcColumns } from "../procColumns";

export type UiActions = Pick<
  Store,
  | "setAlwaysOnTop"
  | "setView"
  | "setTaskDetailId"
  | "setMotion"
  | "setOnboardingDone"
  | "setWorkModes"
  | "setWorkModeChosen"
  | "setTaskView"
  | "setTaskScope"
  | "setTaskProjectFilter"
  | "setRailCollapsed"
  | "setNavCollapsed"
  | "setRailSection"
  | "resetRailSections"
  | "setParticles"
  | "setParticlesIntensity"
  | "setBackground"
  | "setTheme"
  | "upsertTheme"
  | "deleteTheme"
  | "importTheme"
  | "setShell"
  | "setLayout"
  | "setWidgetOrder"
  | "setWidgetHidden"
  | "setWidgetSpan"
  | "resetWidgets"
  | "setProcView"
  | "setProcColumns"
  | "setProcQuery"
  | "setFocusPid"
  | "setRefreshMs"
  | "setToast"
  | "clearToast"
  | "setKillTarget"
>;

export function createUiActions(set: StoreSet, get: StoreGet): UiActions {
  return {
    setAlwaysOnTop: (v) => set({ alwaysOnTop: v }),
    setView: (v) => set({ view: v, taskDetailId: null }),
    setTaskDetailId: (id) => set({ taskDetailId: id }),
    setMotion: (m) => {
      // 显式选档 = 覆盖系统 reduced-motion；立即落到 DOM，
      // 否则三档切换要等下一次主题应用才生效（实测会「点了没反应」）。
      set({ motion: m, motionExplicit: true });
      applyMotion(effectiveMotion(get()));
    },
    setOnboardingDone: () => {
      const current = get();
      set({
        onboardingDone: true,
        workModeChosen: true,
        workModes: current.workModes.length > 0 ? current.workModes : DEFAULT_WORK_MODES,
      });
    },
    setWorkModes: (modes) => {
      const normalized = normalizeWorkModes(modes);
      set({
        workModes: normalized,
        workModeChosen: normalized.length > 0,
      });
    },
    setWorkModeChosen: (chosen) => set({ workModeChosen: chosen }),
    setTaskView: (v) => set({ taskView: v }),
    setTaskScope: (v) => set({ taskScope: v }),
    setTaskProjectFilter: (id) => set({ taskProjectFilter: id }),
    setRailCollapsed: (v) => set({ railCollapsed: v }),
    setNavCollapsed: (v) => set({ navCollapsed: v }),
    setRailSection: (key, v) =>
      set((s) => ({ railSections: { ...s.railSections, [key]: v } })),
    resetRailSections: () =>
      set({ railSections: { projects: true, inbox: true, system: true } }),
    setParticles: (v) => set({ particles: v }),
    setParticlesIntensity: (v) => set({ particlesIntensity: normalizeIntensity(v) }),
    setBackground: (dataUrl) =>
      set({
        backgroundImage:
          dataUrl === null ? null : isBackgroundDataUrl(dataUrl) ? dataUrl : null,
      }),
    setTheme: (id) => {
      set({ theme: id });
      const s = get();
      applyTheme(tokensFor(id, s.customThemes), s.shell, s.layout);
    },
    upsertTheme: (theme) => {
      // 内置主题不进自定义列表：它们随版本升级一起更新，不该被用户副本覆盖。
      // 但「选中一个内置主题」是合法操作 —— 直接走 setTheme，
      // 否则会把 theme 设成一个在列表里不存在的 id（悬空引用，
      // tokensFor 会回退到第一套主题，界面和状态对不上）。
      if (theme.builtin) {
        // 只有真实存在的内置主题才能被选中；否则保留当前主题，
        // 避免 theme 指向一个列表里不存在的 id。
        const known = BUILTIN_THEMES.some((t) => t.id === theme.id);
        if (known) get().setTheme(theme.id);
        return theme.id;
      }
      const existing = get().customThemes;
      const next = [
        ...existing.filter((t) => t.id !== theme.id),
        { ...theme, builtin: false },
      ];
      set({ customThemes: next, theme: theme.id });
      const s = get();
      applyTheme(tokensFor(theme.id, next), s.shell, s.layout);
      return theme.id;
    },
    deleteTheme: (id) => {
      const existing = get().customThemes.filter((t) => t.id !== id);
      const current = get().theme === id ? DEFAULT_THEME_ID : get().theme;
      set({ customThemes: existing, theme: current });
      const s = get();
      applyTheme(tokensFor(current, existing), s.shell, s.layout);
    },
    importTheme: (json) => {
      let raw: unknown;
      try {
        raw = JSON.parse(json);
      } catch {
        return { ok: false, error: t("theme.errJson") };
      }
      const parsed = parseTheme(raw);
      if (!parsed) return { ok: false, error: t("theme.errShape") };
      // 与内置或已有自定义 id 冲突时改名，避免悄悄覆盖别人的主题
      let id = parsed.id;
      const taken = new Set(allThemes(get().customThemes).map((x) => x.id));
      if (taken.has(id)) id = `${id}-${Math.random().toString(36).slice(2, 6)}`;
      get().upsertTheme({ ...parsed, id });
      return { ok: true, id };
    },
    setShell: (shell) => {
      set({ shell });
      const s = get();
      applyTheme(tokensFor(s.theme, s.customThemes), shell, s.layout);
    },
    setLayout: (layout) => {
      set({ layout });
      // 布局也要写进 dataset：CSS 与测试都按 data-layout 判断当前版面，
      // 只改 store 会让属性永远停在初始值（实测切换后仍是 bento）。
      document.documentElement.dataset.layout = layout;
    },
    setWidgetOrder: (widgetOrder) => set({ widgetOrder: normalizeOrder(widgetOrder) }),
    setWidgetHidden: (widgetHidden) =>
      set({ widgetHidden: normalizeHidden(widgetHidden) }),
    setWidgetSpan: (id, span) =>
      set((s) => ({ widgetSpans: normalizeSpans({ ...s.widgetSpans, [id]: span }) })),
    resetWidgets: () =>
      set({ widgetOrder: DEFAULT_ORDER, widgetHidden: [], widgetSpans: {} }),
    setProcView: (procView) => set({ procView }),
    setProcColumns: (procColumns) =>
      set({ procColumns: sanitizeProcColumns(procColumns) }),
    setProcQuery: (procQuery) => set({ procQuery }),
    setFocusPid: (focusPid) => set({ focusPid }),
    setRefreshMs: (ms) => set({ refreshMs: ms }),
    setToast: (toast) => {
      set({ toast });
      setTimeout(() => {
        // 仅在 toast 未被新内容替换时才清除
        set((s) => (s.toast === toast ? { toast: "" } : {}));
      }, TOAST_TTL_MS);
    },
    clearToast: () => set({ toast: "" }),
    setKillTarget: (p) => set({ killTarget: p }),
  };
}
