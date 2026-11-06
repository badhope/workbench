import { escapeHtml } from "../../lib/util";
import type { CostTrendRow, ModelBreakdownRow } from "../../types";

/**
 * 成本页的两张图表选项。
 *
 * 抽成纯函数的原因：它们是 60 多行嵌套对象，塞在组件里让 CostDashboard
 * 的圈复杂度冲到 32（红线 10），也让「tooltip 转义」「扇区缝隙取面板色」
 * 这些安全/视觉细节只能靠人工核对。纯函数可以单测。
 */
export function costTrendOption(
  rows: CostTrendRow[],
  colors: string[],
  labels: { legend: string; tooltip: (value: string) => string }
) {
  // 后端契约：日粒度 YYYY-MM-DD，更早的数据按月聚合成 YYYY-MM。
  //
  // 两者必须在**同一根轴**上可读：早先直接把 YYYY-MM 原样显示、日粒度截成
  // MM-DD，结果一张图的刻度是 `2026-06, 2026-07, 10-25, 10-27`——同一根轴
  // 两种格式，读者无法判断哪些点是月、哪些是日（文档截图里一眼可见）。
  // 现在统一成 `M月` / `M-D`，月份带后缀，日粒度不带，语义一眼可分。
  const days = rows.map((r) => {
    const parts = r.day.split("-");
    // 先按**形状**判断再按长度：只看 length===7 会把 "unknown" 这类
    // 七字符的异常值误判成月度桶，渲染出 `un/NaN月`。
    if (parts.length === 2 && parts.every((p) => /^\d+$/.test(p))) {
      // YYYY-MM（月度桶）：带「月」后缀，与日粒度在轴上可区分
      return `${parts[0].slice(2)}/${Number(parts[1])}月`;
    }
    if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
      // YYYY-MM-DD（日粒度）：保留 M-D
      return `${Number(parts[1])}-${Number(parts[2])}`;
    }
    return r.day;
  });
  return {
    grid: { left: 50, right: 16, top: 20, bottom: 24 },
    tooltip: {
      trigger: "axis",
      formatter: (
        params: { name: string; value: number; seriesName: string; marker: string }[]
      ) => {
        const p = params[0];
        // 日期与文案都可能来自后端/翻译，统一转义后再交给 ECharts 的 innerHTML
        return `${escapeHtml(p.name)}<br/>${escapeHtml(
          labels.tooltip(p.value.toFixed(3))
        )}`;
      },
    },
    legend: {
      data: [labels.legend],
      top: 0,
      right: 8,
      textStyle: { fontSize: 10 },
    },
    xAxis: { type: "category", data: days, boundaryGap: false },
    yAxis: {
      type: "value",
      axisLabel: { fontSize: 10, formatter: (v: number) => `$${v.toFixed(2)}` },
    },
    series: [
      {
        id: "cost-trend",
        name: labels.legend,
        type: "line",
        smooth: true,
        data: rows.map((r) => Math.round(r.cost * 1000) / 1000),
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: `${colors[0]}30` },
              { offset: 1, color: `${colors[0]}05` },
            ],
          },
        },
        lineStyle: { width: 2 },
        itemStyle: { color: colors[0] },
        symbol: "circle",
        symbolSize: 5,
      },
    ],
  };
}

export function modelBreakdownOption(
  rows: ModelBreakdownRow[],
  colors: string[],
  gapColor: string
) {
  return {
    tooltip: { trigger: "item", formatter: "{b}: ${c} ({d}%)" },
    legend: {
      orient: "vertical",
      right: 8,
      top: "middle",
      textStyle: { fontSize: 10 },
    },
    series: [
      {
        id: "model-pie",
        type: "pie",
        radius: ["40%", "68%"],
        center: ["35%", "50%"],
        label: { show: false },
        labelLine: { show: false },
        // 缝隙必须是面板色：取页面底色时浅色主题会露出一圈灰线
        itemStyle: { borderColor: gapColor, borderWidth: 2 },
        data: rows.slice(0, 6).map((r, i) => ({
          name: r.model.length > 20 ? r.model.slice(0, 20) + "…" : r.model,
          value: Math.round(r.cost * 1000) / 1000,
          itemStyle: { color: colors[i % colors.length] },
        })),
      },
    ],
  };
}
