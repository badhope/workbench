import type { ThemeTokens } from "./tokens";
import { applyUiScale } from "../uiScale";
import { registerChartTheme } from "../chartTheme";
import type { ShellId, OverviewLayoutId } from "../layout";

/**
 * 动效档位。off = 全部断闸；standard = 默认节奏；rich = 更长更满。
 * 组件不感知档位，只消费 <html data-motion>（CSS 唯一开关），
 * useCountUp 是唯一的 JS 例外（它需要按档位改时长）。
 */
export type MotionLevel = "off" | "standard" | "rich";

/**
 * 把生效动效档位写到 DOM。
 *
 * 与主题变量一样落在 <html> 上：一个属性开关全站动效，
 * CSS 侧在 global.css 末尾集中断闸，组件零条件渲染。
 */
export function applyMotion(level: MotionLevel): void {
  document.documentElement.dataset.motion = level;
}

/**
 * 把主题 token 写到 DOM。
 *
 * 为什么改成写内联变量：主题现在是用户可编辑的数据，不能为每一种组合
 * 预先在 CSS 里写一个 `[data-theme=...]` 块。内联变量同样只落在一个元素上
 * （`<html>`），组件仍然只消费 `var(--color-*)`，所以没有引入第二种取色路径。
 *
 * `data-theme` 仍然写：它不是配色来源，而是给测试/截图/第三方脚本看的
 * 「当前用的是哪套主题」标识。
 */
export function applyTheme(
  tokens: ThemeTokens,
  shell: ShellId,
  layout: OverviewLayoutId
): void {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(tokens.vars)) {
    root.style.setProperty(k, v);
  }
  root.dataset.theme = tokens.id;
  root.dataset.chartTheme = tokens.dark ? "dark" : "light";
  root.dataset.shell = shell;
  root.dataset.layout = layout;
  // 材质与圆角写成 data 属性：CSS 里有几处「玻璃才模糊」「直角才方」的细节，
  // 用属性选择器比在每个组件里写条件类更集中。用 token 值判断而不是主题名，
  // 用户自建的主题同样生效。
  const material = tokens.vars["--panel-blur"] !== "0px" ? "glass" : "flat";
  root.dataset.material = material;
  root.dataset.radius =
    parseFloat(tokens.vars["--radius-card"]) === 0 ? "sharp" : "round";
  root.style.colorScheme = tokens.dark ? "dark" : "light";
  registerChartTheme(tokens.id, tokens.chart);
  // 缩放属于主题的一部分（同色不同屏需要不同字号），在应用主题时一起生效。
  applyUiScale(Number(tokens.vars["--text-scale"] ?? "1"));
}
