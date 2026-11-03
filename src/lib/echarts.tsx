/**
 * 图表组件入口。
 *
 * 为什么拆成两个文件：ECharts 本体 550 KB，只有画图的页面需要它。
 * 若这里直接 `import * as echarts from "echarts/core"`，任何 import 了
 * `EChart` 的模块都会把整包拉进自己的 chunk；而这个入口同时承担
 * 「组件身份」—— 页面里必须能静态 import 到它（Suspense 才能正常工作）。
 *
 * 所以入口只做一层懒包装：`React.lazy` 指向真正实现，ECharts 本体
 * 作为独立 chunk 在首次渲染图表时才下载。页面代码完全不用改。
 *
 * 代价：图表从「页面 chunk 就绪即可绘制」变成「再多一次网络往返」。
 * 在桌面应用里资源来自本地协议，这个往返是毫秒级的；换来的是
 * 不画图的页面（设置、日志、任务）完全不会加载图表库。
 */
import { lazy, Suspense, type CSSProperties } from "react";
import type { EChartsCoreOption as EChartsOption } from "echarts/core";

const Impl = lazy(() => import("./echartsImpl").then((m) => ({ default: m.EChart })));

export interface EChartProps {
  option: EChartsOption;
  style?: CSSProperties;
  notMerge?: boolean;
  lazyUpdate?: boolean;
  className?: string;
}

/**
 * 占位块：保持与图表相同的高度，避免图表加载完成时页面跳动。
 * 用同一个尺寸而不是固定 150px —— 调用方传的高度各不相同。
 * shimmer 与骨架屏同一语言（transform 位移高光），且可被 data-motion 断闸。
 */
function ChartPlaceholder({
  style,
  className,
}: Pick<EChartProps, "style" | "className">) {
  return (
    <div
      style={style}
      className={`shimmer rounded-[var(--radius-btn)] bg-line/40 ${className ?? ""}`}
      aria-hidden="true"
    />
  );
}

export function EChart(props: EChartProps) {
  return (
    <Suspense
      fallback={<ChartPlaceholder style={props.style} className={props.className} />}
    >
      <Impl {...props} />
    </Suspense>
  );
}
