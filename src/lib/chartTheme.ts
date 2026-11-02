/**
 * 图表配色。
 *
 * 为什么必须显式传 theme 而不是读 DOM：ECharts 不解析 CSS 变量，选项里
 * 必须给真实色值；而页面里图表选项是 useMemo 缓存的，若隐式读
 * document.documentElement.dataset.theme，切换主题时 memo 不重算，
 * 图表会残留旧主题的配色。显式传参让这个依赖进入 deps，可被静态检查。
 *
 * 现在主题是用户可编辑的数据（见 lib/theme/tokens.ts），所以不再只有
 * 「深/浅两套图表色」：applyTheme 会把每套主题的真实色板注册进来，
 * 这里只负责查表 + 在拿不到时按明暗兜底。
 */
export type ThemeName = "dark" | "light";

export interface ChartTheme {
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
  /** 多系列按序取色；缺省时回退到 PALETTE 组合 */
  series?: string[];
}

export const DARK: ChartTheme = {
  bg: "#07080b",
  panel: "#0c0f15",
  line: "#1b212c",
  text: "#e8ecf2",
  dim: "#8a93a6",
  accent: "#22d3ee",
  accentSoft: "#0d2f38",
  ok: "#3ecf8e",
  warn: "#f5b544",
  danger: "#ff6b6b",
};

export const LIGHT: ChartTheme = {
  bg: "#f2f4f7",
  panel: "#ffffff",
  line: "#e2e7ee",
  text: "#10141b",
  dim: "#5b6575",
  accent: "#0b6bcb",
  accentSoft: "#e6f0fc",
  ok: "#0b7a54",
  warn: "#a86400",
  danger: "#c02b2b",
};

/** 主题 id → 真实色板。由 applyTheme 写入，未注册时按明暗兜底。 */
const registry = new Map<string, ChartTheme>();

export function registerChartTheme(id: string, theme: ChartTheme): void {
  registry.set(id, theme);
}

/** 任意主题 id → 图表色板。 */
export function chartTheme(theme: ThemeName | string): ChartTheme {
  const hit = registry.get(theme);
  if (hit) return hit;
  // 未注册（测试、首帧、旧 id）：按明暗兜底
  if (typeof document !== "undefined" && !theme) {
    return document.documentElement.dataset.chartTheme === "light" ? LIGHT : DARK;
  }
  if (
    theme === "light" ||
    theme === "frost" ||
    theme === "paper" ||
    theme === "jade" ||
    theme === "ink"
  ) {
    return LIGHT;
  }
  return DARK;
}

/**
 * 语义色板：原先在 6 个页面里各写一份 hex 数组（AiSessions / Overview /
 * Processes / Servers / Tasks / Projects），改一处就漏其余。统一到这里，
 * 浅色主题取低饱和版本以保证对比度。
 */
export const PALETTE = {
  cyan: "#22d3ee",
  violet: "#a78bfa",
  green: "#3ecf8e",
  amber: "#f5b544",
  red: "#ff6b6b",
  blue: "#60a5fa",
  fuchsia: "#e879f9",
  slate: "#64748b",
} as const;

/** 多系列图表按序取色。浅色主题下 cyan/green/amber/red 换成深色版本。 */
export function seriesColors(theme: ThemeName | string): string[] {
  const t = chartTheme(theme);
  return (
    t.series ?? [
      t.accent,
      PALETTE.violet,
      t.ok,
      t.warn,
      t.danger,
      PALETTE.blue,
      PALETTE.fuchsia,
    ]
  );
}

/** 单色（不随主题）的固定语义色，用于分类标签等不参与主题切换的场景。 */
export const FIXED_COLORS = {
  browser: PALETTE.cyan,
  dev: PALETTE.violet,
  ai: PALETTE.amber,
  system: PALETTE.green,
  other: PALETTE.slate,
  low: PALETTE.slate,
  normal: PALETTE.cyan,
  high: PALETTE.red,
} as const;

/**
 * 图表中「环形图扇区之间的间隙」应使用的颜色。
 *
 * 必须是**面板色**而不是页面底色：环形图画在卡片里，扇区缝隙要看起来是
 * 「卡片被切开了」。早先取的是 bg，浅色主题下卡片是纯白、页面底色是浅灰，
 * 于是每个缝隙都露出一条灰线（Frost 实测可见）。
 */
export function chartGapColor(theme?: string): string {
  if (theme) return chartTheme(theme).panel;
  if (typeof document === "undefined") return DARK.panel;
  return document.documentElement.dataset.chartTheme === "light"
    ? LIGHT.panel
    : DARK.panel;
}

/** 当前主题下的分隔线颜色（用于空数据占位图元）。 */
export function chartLineColor(theme?: string): string {
  if (theme) return chartTheme(theme).line;
  if (typeof document === "undefined") return DARK.line;
  return document.documentElement.dataset.chartTheme === "light" ? LIGHT.line : DARK.line;
}

// ── 通用图表选项构造器 ─────────────────────────────────────
//
// 原先 4 个页面各自手写一遍「横向条形图」配置，结构完全一致、只有颜色与
// 字号不同。抽成构造器后差异集中在参数里，改一处即可全局生效。

export interface HorizontalBarOptions {
  /** 类目轴标签 */
  labels: string[];
  /** 数值；每项可单独指定颜色（两端渐隐），不指定则用默认青色渐变 */
  values: { value: number; color?: string }[];
  /** 主题，决定无自定义颜色时的默认渐变 */
  theme: ThemeName | string;
  /** 左侧留白，标签越长需要越大 */
  left?: number;
  /** 类目轴字号 */
  fontSize?: number;
  /** 是否反转类目顺序（自上而下递增） */
  inverse?: boolean;
  /** 条宽 */
  barWidth?: number;
  /** 数值标签格式化 */
  valueLabel?: string;
}

/** 构造横向条形图配置（类目在 Y 轴、数值在 X 轴、隐藏 X 轴）。 */
export function horizontalBarOption({
  labels,
  values,
  theme,
  left = 72,
  fontSize = 10,
  inverse = false,
  barWidth = 18,
  valueLabel = "{c}",
}: HorizontalBarOptions) {
  const palette = chartTheme(theme);
  const accent = palette.accent;
  return {
    // 右侧留够空间给数值标签：值为 0 时条形长度为 0，
    // 标签会紧贴左边缘，right 太小时更容易被裁掉。
    grid: { left, right: 40, top: 8, bottom: 8 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "value", show: false },
    yAxis: {
      type: "category",
      data: labels,
      inverse,
      axisLabel: { fontSize },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        id: "bar",
        type: "bar",
        barWidth,
        data: values.map((v) => ({
          value: v.value,
          itemStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 1,
              y2: 0,
              colorStops: [
                { offset: 0, color: (v.color ?? accent) + "60" },
                { offset: 1, color: v.color ?? accent },
              ],
            },
            borderRadius: [0, 6, 6, 0],
          },
        })),
        label: {
          show: true,
          position: "right",
          fontSize,
          formatter: valueLabel,
          // 标签颜色必须显式给主题文字色。
          // `color: "inherit"` 会继承 series 的 itemStyle，而这里的 itemStyle
          // 是条形渐变（深色主题下末端接近面板色），实测数字几乎看不见，
          // 看起来像渲染失败而不是"数值偏暗"。
          color: palette.text,
          opacity: 0.85,
        },
      },
    ],
  };
}
