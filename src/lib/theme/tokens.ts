/**
 * 主题 = 一组 token，而不是一段 CSS。
 *
 * 为什么重写：旧实现把五套配色写死在 global.css 的 `[data-theme=...]` 里，
 * 结果是「主题」= 五个只能由开发者新增的常量，用户既不能改也不能带回来。
 * 现在主题是纯数据：颜色、圆角、密度、字体、材质、动效各自独立，
 * 用户可以在设置里改任意一项、复制、导入导出，也能做出和内置五套完全不同的
 * 气质（例如高对比直角 + 等宽 + 无网格）。
 *
 * 派生规则集中在这里，页面和组件不感知主题细节。
 */

export type ThemeId = string;

export type FontChoice = "sans" | "serif" | "mono";
export type Density = "compact" | "cozy" | "roomy";
export type Material = "flat" | "line" | "glass";

export interface ThemeInput {
  id: ThemeId;
  name: string;
  dark: boolean;
  /** 六个核心色，其余全部派生 */
  bg: string;
  panel: string;
  text: string;
  accent: string;
  ok?: string;
  warn?: string;
  danger?: string;
  /** 形状与质感 */
  radiusCard: number;
  radiusBtn: number;
  density: Density;
  font: FontChoice;
  material: Material;
  /** 底纹网格：0 = 无，1 = 强 */
  grid: number;
  /** 面板不透明度（glass 材质下生效） */
  panelOpacity: number;
  /**
   * 字号缩放（0.85–1.2）。
   * 密度只改间距，不改字号；4K 屏与 1080p 笔记本需要的是后者。
   */
  textScale?: number;
  /**
   * 渐变第二强调色。
   * 缺省 = accent 色相 +36°（见 deriveAccent2），再过与 accent 同一道 AA 门槛。
   */
  accent2?: string;
  /**
   * 渐变强调色开关（默认开，总监拍板）。
   * 关掉时 --gradient-accent 退化为 accent 纯色，消费方（按钮/数字）无感知。
   */
  gradientAccent?: boolean;
  /**
   * 氛围光强度 0-100（0 = 关）。
   * glow 原本是 glass 材质的专属装饰，现在独立成主题参数：
   * 非玻璃主题也能有光晕气质。缺省 = glass 材质 55，其余 0。
   */
  glow?: number;
  /**
   * 卡片层级 0-3（0 = 无阴影）。
   * 「精密仪器」语言靠表面 + 描边分层，阴影是辅助而非主角，所以只给四档；
   * 缺省 = flat 材质 1（旧规则「flat 一律无阴影」已废除），其余 2。
   */
  elevation?: 0 | 1 | 2 | 3;
  /** 是否内置（内置不可删除） */
  builtin?: boolean;
}

export interface ThemeTokens {
  id: ThemeId;
  name: string;
  dark: boolean;
  vars: Record<string, string>;
  /** 图表用色，顺序固定，跨图一致 */
  chart: {
    bg: string;
    panel: string;
    line: string;
    text: string;
    dim: string;
    accent: string;
    accentSoft: string;
    ok: string;
    warn: string;
    danger: string;
    series: string[];
  };
}

// ── 颜色工具（不引依赖，主题编辑只要这两三个函数） ──────────

export function parseHex(hex: string): [number, number, number] {
  let h = hex.trim().replace("#", "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 0];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function toHex(rgb: [number, number, number]): string {
  return (
    "#" +
    rgb
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
  );
}

/** amount=0 取 a，1 取 b */
export function mix(a: string, b: string, amount: number): string {
  const [r1, g1, b1] = parseHex(a);
  const [r2, g2, b2] = parseHex(b);
  const k = Math.max(0, Math.min(1, amount));
  return toHex([r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k]);
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

/**
 * 在 text 与 bg 之间找一个「尽可能淡、但仍满足对比度」的颜色。
 *
 * 直接写死混合比例在深色主题上够用、在浅色主题上会掉到 4.3:1：
 * 浅色底上同样比例的混合离白色更近，对比度衰减更快。所以这里按
 * 实际对比度求解，而不是按比例。
 *
 * 返回 (颜色, 实际最低对比度)。
 */
export function mixUntilContrast(
  text: string,
  bg: string,
  otherSurfaces: string[],
  minRatio: number,
  maxMix = 0.72
): { color: string; ratio: number } {
  const worst = (c: string) =>
    Math.min(contrastRatio(c, bg), ...otherSurfaces.map((s) => contrastRatio(c, s)));

  // 目标对比度有可能高于原文的对比度（用户选了低对比文字时）。
  // 这时先朝「远离底色」的方向强化到达标，再从那里往底色方向淡 ——
  // 否则只往底色方向走，对比度只会越来越低，永远达不到目标。
  let base = text;
  if (worst(base) < minRatio) {
    base = ensureTextContrast(text, [bg, ...otherSurfaces], bg, minRatio);
  }
  if (worst(base) < minRatio) {
    // 表面之间跨度大到无解：返回当前最优，由调用方断言/告警
    return { color: base, ratio: worst(base) };
  }

  // 从 base 往底色方向逐步淡，记录「最后一个仍达标的档位」。
  // 这样拿到的是「刚好卡在 minRatio 附近、但明显弱于 base」的一档，
  // 既保住层次，又不会把文字淡到不可读。
  let bestColor = base;
  let bestRatio = worst(base);
  for (let i = 1; i <= Math.round(maxMix * 100); i++) {
    const c = mix(base, bg, i / 100);
    const r = worst(c);
    if (r >= minRatio) {
      bestColor = c;
      bestRatio = r;
    } else {
      break;
    }
  }
  return { color: bestColor, ratio: bestRatio };
}

/**
 * 把一个颜色朝 `toward` 混到「在给定表面上至少满足 minRatio」为止。
 *
 * 用于强调色：品牌色本身往往是给大面积填充选的（例如紫 #8b5cf6），
 * 直接拿来当 11px 文字色只有 4.0:1。这里保持色相不变、只调明度，
 * 既保住品牌辨识度，又保证小字可读。
 */
export function ensureTextContrast(
  color: string,
  surfaces: string[],
  _toward: string,
  minRatio: number,
  maxMix = 0.95
): string {
  const worst = (c: string) => Math.min(...surfaces.map((s) => contrastRatio(c, s)));
  if (worst(color) >= minRatio) return color;

  // 两个方向都试：朝白、朝黑。取「第一个达标且混合量最小」的那个，
  // 这样色相偏移最小。
  //
  // 只朝一个方向走是错的：浅色底上的浅灰文字朝白色混永远不达标
  // （白与白 1:1），一路混到纯白，等于把用户的文字色洗没了。
  const best = firstReaching(color, worst, minRatio, maxMix);
  if (best) return best;

  // 两个方向都不达标（表面之间本身跨度极大）：返回对比度最高的那一档，
  // 而不是随便返回一个 —— 至少保证可读性最大化。
  return highestContrast(color, worst);
}

/** 朝白/朝黑逐档混合，返回第一个达标的颜色（取混合量最小的方向）。 */
function firstReaching(
  color: string,
  ratioOf: (c: string) => number,
  minRatio: number,
  maxMix: number
): string | null {
  let best: { color: string; steps: number } | null = null;
  for (const target of ["#ffffff", "#000000"]) {
    for (let i = 1; i <= Math.round(maxMix * 100); i++) {
      const c = mix(color, target, i / 100);
      if (ratioOf(c) >= minRatio) {
        if (!best || i < best.steps) best = { color: c, steps: i };
        break;
      }
    }
  }
  return best ? best.color : null;
}

/** 无解时取对比度最高的一档（用于极端自定义配色）。 */
function highestContrast(color: string, ratioOf: (c: string) => number): string {
  let fallback = color;
  let bestRatio = ratioOf(color);
  for (let i = 1; i <= 100; i++) {
    for (const target of ["#ffffff", "#000000"]) {
      const c = mix(color, target, i / 100);
      const r = ratioOf(c);
      if (r > bestRatio) {
        bestRatio = r;
        fallback = c;
      }
    }
  }
  return fallback;
}

/** WCAG 2.x 对比度（1..21）。 */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** 相对亮度，用于判断某个底色上该用深字还是浅字 */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ── 派生 ───────────────────────────────────────────────────

const LINE_STRENGTH: Record<Density, number> = {
  compact: 0.13,
  cozy: 0.1,
  roomy: 0.16,
};

const SPACE: Record<Density, string> = {
  compact: "0.75rem",
  cozy: "1rem",
  roomy: "1.375rem",
};

const LINE_HEIGHT: Record<Density, string> = {
  compact: "1.45",
  cozy: "1.55",
  roomy: "1.65",
};

const FONTS: Record<FontChoice, { sans: string; display: string; mono: string }> = {
  sans: {
    sans: `"Segoe UI Variable Display", "Segoe UI", -apple-system, "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif`,
    display: `"Segoe UI Variable Display", "Segoe UI", -apple-system, "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif`,
    mono: `"Cascadia Code", "JetBrains Mono", "SF Mono", Consolas, ui-monospace, monospace`,
  },
  serif: {
    sans: `"Iowan Old Style", "Palatino Linotype", "Songti SC", "SimSun", Georgia, serif`,
    display: `"Iowan Old Style", "Palatino Linotype", "Songti SC", "SimSun", Georgia, serif`,
    mono: `"Cascadia Code", "JetBrains Mono", Consolas, ui-monospace, monospace`,
  },
  mono: {
    sans: `"Cascadia Code", "JetBrains Mono", "SF Mono", Consolas, ui-monospace, monospace`,
    display: `"Cascadia Code", "JetBrains Mono", "SF Mono", Consolas, ui-monospace, monospace`,
    mono: `"Cascadia Code", "JetBrains Mono", "SF Mono", Consolas, ui-monospace, monospace`,
  },
};

/**
 * 选中态底色（`--color-accentsoft`）。
 *
 * 这个值不能只是「面板色混一点强调色」：它在 UI 里专门给
 * `bg-accentsoft text-accent` 这组搭配用（筛选 chip、视图切换、侧栏当前项）。
 * 混色比例写死时，浅色主题上 12% 的 accent 会把底色压得几乎和文字同亮度，
 * 实测 Frost 上「全部/列表」只有 4.45:1 —— 差 0.05 没过 AA，肉眼也是糊的。
 *
 * 所以按「accent 文字压在这个底色上必须达标」反解混色量：从设计意图的
 * 比例出发，不够就往「远离 accent」的方向加深/减淡，够了立刻停手，
 * 尽量保住原本的淡色观感。
 */
function softAccent(panel: string, accent: string, dark: boolean): string {
  const target = 4.6; // 4.5 + 抗锯齿余量，与正文同一门槛
  const base = dark ? 0.18 : 0.12;
  // 深色主题：底色越暗越能衬出浅色 accent，所以先按基准，再逐步减少混入量。
  // 浅色主题：反过来，混得越少底色越浅；两种方向都试，取第一个达标的。
  const steps = dark
    ? [base, base - 0.04, base - 0.08, base - 0.12, 0]
    : [base, base - 0.03, base - 0.06, 0.06, 0.03, 0];
  for (const amount of steps) {
    if (amount < 0) continue;
    const candidate = mix(panel, accent, amount);
    if (contrastRatio(accent, candidate) >= target) return candidate;
  }
  // 全部不达标：退到纯面板色，这是能保证的最浅/最深底。
  return panel;
}

/**
 * 把用户输入展开成完整 token。
 *
 * 只让用户填「六个颜色 + 五个旋钮」的原因：完整 token 有二十多个，
 * 逐个填是把设计系统的负担丢给用户。其余值都能从这六个色推出来，
 * 且推导是单调的——改 accent 不会破坏对比度层级。
 */
export function buildTheme(input: ThemeInput): ThemeTokens {
  const semantic = resolveSemantic(input);
  // dim / faint 都由「对比度下限」求解，而不是写死混合比例：
  // 同一比例在深色底和浅色底上的实际对比度差很多（浅色主题上会掉到 4.3:1）。
  // 目标：dim ≥ 6.0:1、faint ≥ 4.7:1（高于 WCAG AA 的 4.5，留一点抗渲染误差余量）。
  // 文字可能落在页面底、面板底、次级面板底（表格斑马纹）三种表面上。
  const { text, dim, faint, accent, accent2, okSafe, warnSafe, dangerSafe } = semantic;
  const panel2 = mix(input.panel, input.bg, 0.45);
  const line = mix(text, input.bg, 1 - LINE_STRENGTH[input.density]);
  const accentsoft = softAccent(input.panel, accent, input.dark);
  const fonts = FONTS[input.font];

  const vars = themeVars(input, {
    panel2,
    line,
    text,
    dim,
    faint,
    accent,
    accent2,
    accentsoft,
    okSafe,
    warnSafe,
    dangerSafe,
    fonts,
  });

  return {
    id: input.id,
    name: input.name,
    dark: input.dark,
    vars,
    chart: {
      bg: input.bg,
      panel: input.panel,
      line,
      text: input.text,
      dim,
      accent,
      accentSoft: accentsoft,
      ok: okSafe,
      warn: warnSafe,
      danger: dangerSafe,
      // 系列色由主题派生，而不是写死三个固定色：写死时 Paper（米色）与
      // Ink（黑白红）上会突然冒出紫色和粉色，与整页气质冲突。
      series: chartSeries(accent, input.dark),
    },
  };
}

/**
 * 语义色 + 正文/辅助文字的对比度求解。
 *
 * 正文是唯一不允许降级的元素：先用它自己过一遍门槛，dim/faint 再以这个
 * 「可读的正文色」为基准往外淡。强调色与语义色同时承担填充与小字两种角色，
 * 一起过同一道 4.6 的门槛（4.5 + 抗锯齿余量）。
 */
function resolveSemantic(input: ThemeInput) {
  const ok = input.ok ?? (input.dark ? "#3ecf8e" : "#0b7a54");
  const warn = input.warn ?? (input.dark ? "#f5b544" : "#a86400");
  const danger = input.danger ?? (input.dark ? "#ff6b6b" : "#c02b2b");
  const toward = input.dark ? "#ffffff" : "#000000";
  const surfaces = [input.bg, input.panel, mix(input.panel, input.bg, 0.45)];
  const text = ensureTextContrast(input.text, surfaces, toward, 4.6);
  const accent = ensureTextContrast(input.accent, surfaces, toward, 4.6);
  return {
    surfaces,
    text,
    dim: mixUntilContrast(text, input.bg, surfaces, 6.0).color,
    faint: mixUntilContrast(text, input.bg, surfaces, 4.7).color,
    accent,
    // accent2 与 accent 同一道门槛（4.6）：渐变两端都是安全色，
    // 渐变中段的对比度才不会跌破 AA（两端达标 ≠ 中间达标，但两端
    // 都是 4.6 时插值最坏也就略低，实际渐变只用于大面积文字/按钮）。
    accent2: ensureTextContrast(
      input.accent2 ?? deriveAccent2(input.accent),
      surfaces,
      toward,
      4.6
    ),
    okSafe: ensureTextContrast(ok, surfaces, toward, 4.6),
    warnSafe: ensureTextContrast(warn, surfaces, toward, 4.6),
    dangerSafe: ensureTextContrast(danger, surfaces, toward, 4.6),
  };
}

interface DerivedColors {
  panel2: string;
  line: string;
  text: string;
  dim: string;
  faint: string;
  accent: string;
  accent2: string;
  accentsoft: string;
  okSafe: string;
  warnSafe: string;
  dangerSafe: string;
  fonts: { sans: string; display: string; mono: string };
}

/** 26 个 CSS 变量。抽成纯函数：buildTheme 的圈复杂度原本 19，红线 10。 */
function themeVars(input: ThemeInput, c: DerivedColors): Record<string, string> {
  // 主按钮的文字色：必须在 accent 填充上可读，且与主题深浅无关。
  // 写死 #04120f 在浅色主题（accent 变深）上会变成深字压深底。
  const onAccent =
    ensureTextContrast("#ffffff", [c.accent], c.accent, 4.5) === "#ffffff"
      ? "#ffffff"
      : ensureTextContrast("#000000", [c.accent], c.accent, 4.5);
  // 渐变强调色：两端都是过了 AA 的安全色。关档时不直接给纯色值 ——
  // 消费方写的是 background-image，纯色值会被静默丢弃；退化为
  // 「accent → accent」的零跨度渐变，视觉等同纯色且单一代码路径。
  const gradientAccent =
    input.gradientAccent === false
      ? `linear-gradient(120deg, ${c.accent}, ${c.accent})`
      : `linear-gradient(120deg, ${c.accent}, ${c.accent2})`;
  const shadows = cardShadows(input);
  return {
    "--color-bg": input.bg,
    "--color-panel": input.panel,
    "--color-panel2": c.panel2,
    "--color-line": c.line,
    "--color-text": c.text,
    "--color-dim": c.dim,
    "--color-faint": c.faint,
    "--color-accent": c.accent,
    "--color-accent2": c.accent2,
    "--color-on-accent": onAccent,
    "--color-accentsoft": c.accentsoft,
    "--gradient-accent": gradientAccent,
    "--color-ok": c.okSafe,
    "--color-warn": c.warnSafe,
    "--color-danger": c.dangerSafe,
    "--font-sans": c.fonts.sans,
    "--font-display": c.fonts.display,
    "--font-mono": c.fonts.mono,
    "--radius-card": `${input.radiusCard}px`,
    "--radius-btn": `${input.radiusBtn}px`,
    "--shadow-card": shadows.rest,
    "--shadow-card-hover": shadows.hover,
    "--space-card": SPACE[input.density],
    "--line-height-body": LINE_HEIGHT[input.density],
    "--tracking-heading": input.font === "serif" ? "0.005em" : "-0.02em",
    "--hairline": withAlpha(input.text, input.dark ? 0.08 : 0.1),
    "--hairline-strong": withAlpha(input.text, input.dark ? 0.14 : 0.18),
    "--panel-opacity": String(Math.max(0.2, Math.min(1, input.panelOpacity))),
    "--panel-blur": input.material === "glass" ? "20px" : "0px",
    "--grid-strength": String(Math.max(0, Math.min(1, input.grid))),
    // 氛围光由主题参数 glow 决定（0-100 → 0-1），不再绑定材质；
    // 颜色仍取主题 accent，所以每套主题的渐变背景都不同。
    "--glow": String(clampGlow(input.glow, input.material) / 100),
    // 浅色底上给卡片加白色高光只会把它洗灰，所以浅色主题一律关掉
    "--card-sheen": input.dark ? "3.5" : "0",
    "--text-scale": String(clampTextScale(input.textScale)),
  };
}

/** 字号缩放限制在 0.85–1.2：再小读不清，再大右侧栏会挤爆。 */
export function clampTextScale(v: number | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 1;
  return Math.max(0.85, Math.min(1.2, v));
}

/**
 * 氛围光 0-100，越界夹取；缺省值跟随材质（glass 55，其余 0）。
 * 导入 JSON / 编辑器滑杆都可能给出任意数值，这里集中收口。
 */
export function clampGlow(v: number | undefined, material: Material): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return material === "glass" ? 55 : 0;
  }
  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * 卡片层级 0-3，越界夹取；缺省 flat 材质 1、其余 2。
 * 「flat = 无阴影」的旧规则已废除：亮色主题上一档浅阴影反而更像实体卡片。
 */
export function clampElevation(v: number | undefined, material: Material): 0 | 1 | 2 | 3 {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return material === "flat" ? 1 : 2;
  }
  return Math.max(0, Math.min(3, Math.round(v))) as 0 | 1 | 2 | 3;
}

/**
 * 渐变第二色：accent 色相 +36°，饱和度/明度保持。
 * 相邻色相 = 「同族渐变」，比撞色渐变更贴合「精密仪器」的克制气质；
 * 用户嫌不够可以显式指定 accent2，派生值只兜底。
 */
export function deriveAccent2(accent: string): string {
  const rgb = parseHex(accent);
  const [h, s] = rgbToHsl(rgb);
  // rgbToHsl 只返回 (h, s)；HSL 明度 = (max+min)/2，在这里补算
  const l = (Math.max(...rgb) + Math.min(...rgb)) / 2 / 255;
  return hslToHex((h + 36) % 360, s, l);
}

/**
 * 图表系列色：以强调色为起点，按色相旋转生成 8 色。
 *
 * 为什么按色相旋转而不是固定调色板：主题是用户数据，固定调色板必然有
 * 主题与它冲突（米色纸感主题配紫色系列）。旋转保持「同族颜色」，
 * 每套主题的图表都像是这套主题自己长出来的。
 *
 * 饱和度和明度按深浅模式微调：深色底上需要更亮、略降饱和，否则刺眼；
 * 浅色底上需要更深，否则在白卡片上发灰。
 */
export function chartSeries(accent: string, dark: boolean): string[] {
  const [h, sat] = rgbToHsl(parseHex(accent));
  const s = Math.max(0.35, Math.min(0.9, sat * (dark ? 0.95 : 1.05)));
  const l = dark ? 0.62 : 0.42;
  // 首色固定是强调色本身：主系列必须与品牌色一致，否则图表和按钮
  // 看起来像两个产品。其余 7 色按色相旋转派生。
  const offsets = [38, 76, 152, 196, 228, 280, 320];
  return [accent, ...offsets.map((d) => hslToHex((h + d) % 360, s, l))];
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn
      ? ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
      : max === gn
        ? ((bn - rn) / d + 2) / 6
        : ((rn - gn) / d + 4) / 6;
  return [h * 360, s];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = l - c / 2;
  return toHex([
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ]);
}

/**
 * 卡片阴影：由 elevation（0-3）求解，而不是按材质一刀切。
 *
 * 「material=flat 一律 none」的旧规则被废除：亮色 flat 主题给一档浅阴影
 * 反而更像实体卡片；真正的开关是 elevation=0（Terminal/Ink/Void/Mono Brutal
 * 这类「印刷品」主题显式关闭）。
 *
 * 暗色主题的阴影天然偏「黑块」：用低透明大阴影 + 1px 内描边补偿轮廓，
 * 否则深底上卡片边界只能靠猜。hover 档取 elevation+1，配合 CSS 的
 * translateY(-2px) 组成「微抬升」；已到顶档则维持原档（不再加深）。
 */
function cardShadows(input: ThemeInput): { rest: string; hover: string } {
  const level = clampElevation(input.elevation, input.material);
  if (level === 0) return { rest: "none", hover: "none" };
  const ring = input.dark ? `inset 0 0 0 1px ${withAlpha(input.text, 0.1)}, ` : "";
  const dark: Record<1 | 2 | 3, string> = {
    1: `0 1px 2px ${withAlpha("#000000", 0.35)}, 0 10px 24px -20px ${withAlpha("#000000", 0.7)}`,
    2: `0 1px 2px ${withAlpha("#000000", 0.5)}, 0 18px 40px -24px ${withAlpha("#000000", 0.9)}`,
    3: `0 2px 4px ${withAlpha("#000000", 0.5)}, 0 28px 60px -28px ${withAlpha("#000000", 0.95)}`,
  };
  const light: Record<1 | 2 | 3, string> = {
    1: `0 1px 2px ${withAlpha("#101828", 0.05)}, 0 8px 18px -16px ${withAlpha("#101828", 0.2)}`,
    2: `0 1px 2px ${withAlpha("#101828", 0.06)}, 0 14px 30px -22px ${withAlpha("#101828", 0.28)}`,
    3: `0 2px 4px ${withAlpha("#101828", 0.07)}, 0 24px 48px -26px ${withAlpha("#101828", 0.34)}`,
  };
  const table = input.dark ? dark : light;
  const hoverLevel = Math.min(3, level + 1) as 1 | 2 | 3;
  return { rest: ring + table[level], hover: ring + table[hoverLevel] };
}
