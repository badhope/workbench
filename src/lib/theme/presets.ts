import { buildTheme, mix, type ThemeInput, type ThemeTokens } from "./tokens";

/**
 * 内置主题。它们现在只是「几行数据」，和用户自建主题走同一条渲染管线——
 * 这样任何内置主题都能在设置里被「复制为新主题」后随意改，不会出现
 * 「官方主题能做的事自定义主题做不到」的二等公民。
 */
export const BUILTIN_THEMES: ThemeInput[] = [
  {
    id: "midnight",
    name: "Midnight",
    dark: true,
    bg: "#07080b",
    panel: "#0c0f15",
    text: "#e8ecf2",
    accent: "#22d3ee",
    radiusCard: 10,
    radiusBtn: 7,
    density: "cozy",
    font: "sans",
    material: "line",
    grid: 1,
    panelOpacity: 1,
    builtin: true,
  },
  {
    id: "frost",
    name: "Frost",
    dark: false,
    bg: "#f2f4f7",
    panel: "#ffffff",
    text: "#10141b",
    accent: "#0b6bcb",
    radiusCard: 16,
    radiusBtn: 8,
    density: "cozy",
    font: "sans",
    material: "flat",
    grid: 0.55,
    panelOpacity: 1,
    builtin: true,
  },
  {
    id: "paper",
    name: "Paper",
    dark: false,
    bg: "#f3eee5",
    panel: "#fbf8f2",
    text: "#241f19",
    accent: "#8a5a2b",
    radiusCard: 2,
    radiusBtn: 2,
    density: "roomy",
    font: "serif",
    material: "flat",
    grid: 0.4,
    panelOpacity: 1,
    builtin: true,
  },
  {
    id: "aurora",
    name: "Aurora",
    dark: true,
    bg: "#080a18",
    panel: "#141a33",
    text: "#eaeefe",
    accent: "#8b5cf6",
    radiusCard: 18,
    radiusBtn: 10,
    density: "cozy",
    font: "sans",
    material: "glass",
    grid: 0,
    panelOpacity: 0.58,
    // 玻璃主题的默认 glow 是 55，Aurora 原本就是满档光晕，显式给 60 保住气质
    glow: 60,
    builtin: true,
  },
  {
    id: "terminal",
    name: "Terminal",
    dark: true,
    bg: "#050706",
    panel: "#0a0e0b",
    text: "#d9f5d9",
    accent: "#3ddc84",
    radiusCard: 0,
    radiusBtn: 0,
    density: "compact",
    font: "mono",
    material: "flat",
    grid: 0,
    panelOpacity: 1,
    // 「印刷品」三兄弟显式关阴影：elevation 求解后 flat 默认是 1，
    // 不写 0 的话这套极简主题会凭空多出浅阴影。
    elevation: 0,
    builtin: true,
  },
  {
    id: "ink",
    name: "Ink",
    dark: false,
    bg: "#f7f7f5",
    panel: "#ffffff",
    text: "#111111",
    accent: "#d92b2b",
    radiusCard: 0,
    radiusBtn: 0,
    density: "compact",
    font: "sans",
    material: "line",
    grid: 0,
    panelOpacity: 1,
    elevation: 0,
    builtin: true,
  },
  {
    id: "void",
    name: "Void",
    dark: true,
    bg: "#000000",
    panel: "#050505",
    text: "#f2f2f2",
    accent: "#ff4d00",
    radiusCard: 2,
    radiusBtn: 2,
    density: "compact",
    font: "mono",
    material: "line",
    grid: 0,
    panelOpacity: 1,
    elevation: 0,
    builtin: true,
  },
  {
    id: "jade",
    name: "Jade",
    dark: false,
    bg: "#eef2ee",
    panel: "#f8fbf8",
    text: "#1b241f",
    accent: "#1f7a5a",
    radiusCard: 8,
    radiusBtn: 6,
    density: "cozy",
    font: "sans",
    material: "flat",
    grid: 0.3,
    panelOpacity: 1,
    builtin: true,
  },
  // ── 视觉 2.0 新增八套（4 暗 4 亮）──
  // 全部与旧八套同管线：过 buildTheme 的 AA 求解，缺省 token 不写、由派生兜底。
  {
    id: "midnight-aurora",
    name: "Midnight Aurora",
    dark: true,
    bg: "#050b10",
    panel: "#0a141d",
    text: "#ddeee9",
    accent: "#2fe6c0",
    radiusCard: 14,
    radiusBtn: 9,
    density: "cozy",
    font: "sans",
    material: "glass",
    grid: 0,
    panelOpacity: 0.56,
    glow: 45,
    builtin: true,
  },
  {
    id: "ember",
    name: "Ember",
    dark: true,
    bg: "#0d0806",
    panel: "#170e0a",
    text: "#f4e8df",
    accent: "#ff8a5c",
    radiusCard: 8,
    radiusBtn: 6,
    density: "cozy",
    font: "sans",
    material: "line",
    grid: 0.45,
    panelOpacity: 1,
    glow: 30,
    builtin: true,
  },
  {
    id: "matcha",
    name: "Matcha",
    dark: true,
    bg: "#0b100c",
    panel: "#121a13",
    text: "#e9f1e4",
    accent: "#a6c96a",
    radiusCard: 10,
    radiusBtn: 7,
    density: "cozy",
    font: "sans",
    material: "flat",
    grid: 0.3,
    panelOpacity: 1,
    glow: 0,
    builtin: true,
  },
  {
    id: "grape-soda",
    name: "Grape Soda",
    dark: true,
    bg: "#0e0a1a",
    panel: "#181028",
    text: "#efe9fc",
    accent: "#b78bff",
    radiusCard: 16,
    radiusBtn: 10,
    density: "cozy",
    font: "sans",
    material: "glass",
    grid: 0,
    panelOpacity: 0.6,
    glow: 40,
    builtin: true,
  },
  {
    id: "nordic-light",
    name: "Nordic Light",
    dark: false,
    bg: "#edf1f5",
    panel: "#ffffff",
    text: "#1c2733",
    accent: "#2e6da4",
    radiusCard: 12,
    radiusBtn: 8,
    density: "cozy",
    font: "sans",
    material: "flat",
    grid: 0.5,
    panelOpacity: 1,
    glow: 0,
    builtin: true,
  },
  {
    id: "sakura",
    name: "Sakura",
    dark: false,
    bg: "#faf1f3",
    panel: "#fffdfd",
    text: "#3c2b31",
    accent: "#b04a75",
    radiusCard: 14,
    radiusBtn: 9,
    density: "roomy",
    font: "serif",
    material: "flat",
    grid: 0.3,
    panelOpacity: 1,
    glow: 0,
    builtin: true,
  },
  {
    id: "mono-brutal",
    name: "Mono Brutal",
    dark: false,
    bg: "#ffffff",
    panel: "#ffffff",
    text: "#000000",
    accent: "#000000",
    radiusCard: 0,
    radiusBtn: 0,
    density: "compact",
    font: "sans",
    material: "line",
    grid: 0,
    panelOpacity: 1,
    glow: 0,
    elevation: 0,
    builtin: true,
  },
  {
    id: "sky",
    name: "Sky",
    dark: false,
    bg: "#eff6f9",
    panel: "#ffffff",
    text: "#132b35",
    accent: "#0f7fa8",
    radiusCard: 12,
    radiusBtn: 8,
    density: "cozy",
    font: "sans",
    material: "flat",
    grid: 0.45,
    panelOpacity: 1,
    glow: 0,
    builtin: true,
  },
];

export const DEFAULT_THEME_ID = "frost";

/** 旧版本持久化的 "dark"/"light"，以及已删除的自定义主题 id。 */
export function migrateThemeId(raw: unknown, known: ThemeInput[]): string {
  if (typeof raw === "string") {
    if (known.some((t) => t.id === raw)) return raw;
    if (raw === "light") return "frost";
    if (raw === "dark") return "midnight";
  }
  return DEFAULT_THEME_ID;
}

export function allThemes(custom: ThemeInput[]): ThemeInput[] {
  // 自定义列表里若混进了 builtin:true（手工编辑过 localStorage、旧格式），
  // 不丢弃它——那是用户的主题。强制降级为自定义，避免它凭空消失。
  return [...BUILTIN_THEMES, ...custom.map((c) => ({ ...c, builtin: false }))];
}

export function findTheme(id: string, custom: ThemeInput[]): ThemeInput {
  return allThemes(custom).find((t) => t.id === id) ?? BUILTIN_THEMES[0];
}

export function tokensFor(id: string, custom: ThemeInput[]): ThemeTokens {
  return buildTheme(findTheme(id, custom));
}

/** 新建自定义主题时的起点：把当前主题复制一份，只换个名字。 */
export function deriveTheme(base: ThemeInput, name: string, id: string): ThemeInput {
  return { ...base, id, name, builtin: false };
}

/**
 * 把「用户想编辑的主题」变成一个可以安全保存的主题。
 *
 * 内置主题不能原地改：`allThemes()` 把内置放在最前面，`findTheme()` 取第一个
 * 匹配 id，所以若把内置的 id 原样写进自定义列表，用户改完看到的是同名但
 * 被内置挡住的影子主题 —— 编辑框回读旧色值，界面纹丝不动。这里改成
 * 「编辑内置 = 自动复制一份并换新 id」，返回 `copied` 让调用方给出提示。
 */
export function editableTheme(
  theme: ThemeInput,
  makeId: () => string
): { theme: ThemeInput; copied: boolean } {
  if (!theme.builtin) return { theme: { ...theme, builtin: false }, copied: false };
  return {
    theme: deriveTheme(theme, `${theme.name} copy`, makeId()),
    copied: true,
  };
}

/** 设置页色卡预览用的四个色块：底、面板、强调、文字。 */
export function swatchOf(input: ThemeInput): [string, string, string, string] {
  return [input.bg, input.panel, input.accent, input.text];
}

/**
 * 主题校验：导入的 JSON 来自外部，必须 fail-closed。
 * 返回 null 表示不可用（调用方负责提示），而不是「尽量修一修」——
 * 半修好的主题会在界面上产生不可读的低对比文本。
 */
export function parseTheme(raw: unknown): ThemeInput | null {
  const o = asRecord(raw);
  if (!o) return null;

  const base = readCore(o);
  if (!base) return null;

  const density = pick(o.density, DENSITIES, "cozy");
  const font = pick(o.font, FONTS, "sans");
  const material = pick(o.material, MATERIALS, "line");

  return {
    ...base,
    dark: typeof o.dark === "boolean" ? o.dark : luminanceOf(base.bg) < 0.4,
    ok: nonEmpty(o.ok),
    warn: nonEmpty(o.warn),
    danger: nonEmpty(o.danger),
    // 视觉 2.0 新字段：只 clamp / 落默认，不因缺失拒绝（旧 JSON 零迁移成本）。
    // accent2 非法时丢弃（回退派生值）而不是整体拒绝：渐变第二色坏了
    // 有安全兜底，不值得让整份主题导入失败。
    accent2: hexOrUndefined(o.accent2),
    gradientAccent: typeof o.gradientAccent === "boolean" ? o.gradientAccent : undefined,
    glow: clampOpt(o.glow, 0, 100),
    elevation: clampOpt(o.elevation, 0, 3) as 0 | 1 | 2 | 3 | undefined,
    radiusCard: clamp(o.radiusCard, 0, 40, 10),
    radiusBtn: clamp(o.radiusBtn, 0, 24, 7),
    density,
    font,
    material,
    grid: clamp(o.grid, 0, 1, 0),
    panelOpacity: clamp(o.panelOpacity, 0.2, 1, 1),
    textScale: clamp(o.textScale, 0.85, 1.2, 1),
    builtin: false,
  };
}

const DENSITIES = ["compact", "cozy", "roomy"] as const;
const FONTS = ["sans", "serif", "mono"] as const;
const MATERIALS = ["flat", "glass", "line"] as const;

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

function nonEmpty(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function clamp(v: unknown, lo: number, hi: number, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.min(hi, Math.max(lo, v))
    : dflt;
}

/** 缺省返回 undefined（让 buildTheme 按材质/规则派生），存在则夹到区间内并取整。 */
function clampOpt(v: unknown, lo: number, hi: number): number | undefined {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.round(Math.min(hi, Math.max(lo, v)))
    : undefined;
}

/** 可选颜色字段：空/非法一律 undefined（回退派生），绝不抛出半截字符串。 */
function hexOrUndefined(v: unknown): string | undefined {
  const s = nonEmpty(v);
  return s && HEX.test(s) ? s : undefined;
}

function pick<T extends string>(v: unknown, allowed: readonly T[], dflt: T): T {
  return allowed.includes(v as T) ? (v as T) : dflt;
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** 六个必填字段（id/name/四个颜色）。任一缺失或不是合法颜色 → 整份拒绝。 */
function readCore(o: Record<string, unknown>): {
  id: string;
  name: string;
  bg: string;
  panel: string;
  text: string;
  accent: string;
} | null {
  const id = nonEmpty(o.id);
  const name = nonEmpty(o.name);
  const bg = nonEmpty(o.bg);
  const panel = nonEmpty(o.panel);
  const text = nonEmpty(o.text);
  const accent = nonEmpty(o.accent);
  if (!id || !name || !bg || !panel || !text || !accent) return null;
  if (![bg, panel, text, accent].every((c) => HEX.test(c))) return null;
  return { id, name, bg, panel, text, accent };
}

function luminanceOf(hex: string): number {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 供设置页展示的一句话描述（不写进主题数据，避免用户自定义主题也要翻译）。 */
export function describeTheme(t: ThemeInput): string {
  const bits = [t.dark ? "dark" : "light", t.material];
  if (t.font !== "sans") bits.push(t.font);
  if (t.density !== "cozy") bits.push(t.density);
  return bits.join(" · ");
}

/** 主题派生一个小色带，用于设置页列表左侧的竖条。 */
export function themeStripe(t: ThemeInput): string {
  return `linear-gradient(180deg, ${t.accent}, ${mix(t.accent, t.bg, 0.55)})`;
}
