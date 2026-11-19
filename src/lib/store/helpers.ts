import { allThemes, migrateThemeId, parseTheme } from "../theme/presets";
import type { ThemeInput } from "../theme/tokens";
import type { MotionLevel } from "../theme/apply";
import {
  normalizeHidden,
  normalizeLayout,
  normalizeOrder,
  normalizeShell,
  normalizeSpans,
} from "../layout";
import { DEFAULT_WORK_MODES, normalizeWorkModes } from "../workModes";
import type { WorkbenchData } from "../../types";

export const HISTORY_LEN = 60;
export const TOAST_TTL_MS = 2600;
export const SAVE_DEBOUNCE_MS = 300;

export const emptyData: WorkbenchData = { projects: [], tasks: [] };

/** 服务端快照 → 本地完整数据：缺字段用空骨架补齐，避免旧版数据出现 undefined。 */
export function mergeSnapshot(data: WorkbenchData): WorkbenchData {
  return { ...emptyData, ...data };
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** 系统是否要求减弱动效。jsdom / 老旧 WebView 没有 matchMedia，视为否。 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * 生效动效档位 = 显式选择优先，否则尊重系统 reduced-motion。
 *
 * 这是「允许覆盖」语义的唯一实现点：CSS 不再读 prefers-reduced-motion，
 * 全部动效断闸都走 data-motion 这一个属性。
 */
export function effectiveMotion(s: {
  motion: MotionLevel;
  motionExplicit: boolean;
}): MotionLevel {
  if (s.motion === "off") return "off";
  if (!s.motionExplicit && prefersReducedMotion()) return "off";
  return s.motion;
}

const MOTION_LEVELS: MotionLevel[] = ["off", "standard", "rich"];

function normalizeMotion(v: unknown): MotionLevel {
  return MOTION_LEVELS.includes(v as MotionLevel) ? (v as MotionLevel) : "standard";
}

/** 粒子/氛围强度统一钳制：非数字落默认 65，越界截断，取整。 */
export function normalizeIntensity(v: unknown, fallback = 65): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/**
 * 背景图白名单：只接受 data:image/* URL。
 * localStorage 一旦存进 script: 之类的东西，任何「把它当 CSS 用」的
 * 路径都是注入面——在写入源头就拒收，比在每个消费点防御便宜得多。
 */
export function isBackgroundDataUrl(v: unknown): v is string {
  return typeof v === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(v);
}

/**
 * persist 迁移主体（导出仅为单测可直接断言迁移行为）。
 *
 * 版本 3 → 4：新增动效档位与首启引导偏好。迁移只补默认值，
 * 不覆盖用户已显式保存的值——丢偏好的事故比缺默认值严重得多。
 */
export function migratePersisted(persisted: unknown): Record<string, unknown> {
  const state = (persisted ?? {}) as Record<string, unknown>;
  const rail = (state.railSections ?? {}) as Record<string, unknown>;
  const customThemes: ThemeInput[] = Array.isArray(state.customThemes)
    ? state.customThemes
        .map((x) => parseTheme(x))
        .filter((x): x is ThemeInput => Boolean(x))
    : [];
  return {
    ...state,
    customThemes,
    theme: migrateThemeId(state.theme, allThemes(customThemes)),
    shell: normalizeShell(state.shell),
    layout: normalizeLayout(state.layout),
    widgetOrder: normalizeOrder(state.widgetOrder),
    widgetHidden: normalizeHidden(state.widgetHidden),
    widgetSpans: normalizeSpans(state.widgetSpans),
    procView: state.procView === "tree" ? "tree" : "flat",
    taskView: state.taskView === "board" ? "board" : "list",
    taskScope:
      state.taskScope === "today" ||
      state.taskScope === "week" ||
      state.taskScope === "inbox" ||
      state.taskScope === "blocked"
        ? state.taskScope
        : "all",
    taskProjectFilter:
      typeof state.taskProjectFilter === "string" ? state.taskProjectFilter : "",
    railCollapsed: state.railCollapsed === true,
    navCollapsed: state.navCollapsed === true,
    railSections: {
      projects: rail.projects !== false,
      inbox: rail.inbox !== false,
      system: rail.system !== false,
    },
    motion: normalizeMotion(state.motion),
    motionExplicit: state.motionExplicit === true,
    onboardingDone: state.onboardingDone === true,
    workModes:
      normalizeWorkModes(state.workModes).length > 0
        ? normalizeWorkModes(state.workModes)
        : state.onboardingDone === true
          ? DEFAULT_WORK_MODES
          : [],
    workModeChosen: state.workModeChosen === true || state.onboardingDone === true,
    particles: state.particles === true,
    particlesIntensity: normalizeIntensity(state.particlesIntensity),
    backgroundImage: isBackgroundDataUrl(state.backgroundImage)
      ? state.backgroundImage
      : null,
  };
}
