import { describe, expect, it } from "vitest";
import { costTrendOption } from "./costCharts";
import type { CostTrendRow } from "../../types";

/**
 * 成本趋势图选项。
 *
 * 重点不在「对象长得对」，而在两条会直接影响可读性的约定：
 * 1) 月度桶与日粒度桶混排在同一根 X 轴时，标签必须能区分粒度——
 *    早先 `2026-06` 与 `10-25` 并排出现，读者无法判断哪些点是月、哪些是日；
 * 2) tooltip 会拼进 innerHTML，来自后端/翻译的文本必须转义。
 */
const row = (day: string, cost: number): CostTrendRow => ({
  day,
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  cost,
  record_count: 1,
});

const labels = {
  legend: "Cost",
  tooltip: (v: string) => `Cost (USD): ${v}`,
};

/** ECharts tooltip 回调的形状（只取测试用得到的部分）。 */
type TooltipFormatter = (
  params: { name: string; value: number; seriesName: string; marker: string }[]
) => string;

const formatterOf = (opt: ReturnType<typeof costTrendOption>): TooltipFormatter =>
  (opt.tooltip as { formatter: TooltipFormatter }).formatter;

describe("costTrendOption", () => {
  it("月度桶带「月」标记，日粒度不带，混排时可区分", () => {
    const opt = costTrendOption(
      [row("2026-06", 10), row("2026-07", 8), row("2026-10-25", 1.5)],
      ["#123456"],
      labels
    );
    const days = (opt.xAxis as { data: string[] }).data;
    expect(days).toEqual(["26/6月", "26/7月", "10-25"]);
    // 两种粒度不能出现同一种形态（否则读者分不清）
    expect(days[0]).not.toBe(days[2]);
  });

  it("单日数据保留 M-D，去掉前导零", () => {
    const opt = costTrendOption([row("2026-01-05", 1)], ["#123456"], labels);
    expect((opt.xAxis as { data: string[] }).data).toEqual(["1-5"]);
  });

  it("残缺日期原样保留，不抛错", () => {
    const opt = costTrendOption([row("unknown", 0)], ["#123456"], labels);
    expect((opt.xAxis as { data: string[] }).data).toEqual(["unknown"]);
  });

  it("tooltip 转义来自数据的字符，防止 innerHTML 注入", () => {
    const opt = costTrendOption([row("<img src=x>", 1)], ["#123456"], labels);
    const formatter = formatterOf(opt);
    const html = formatter([
      { name: "<script>alert(1)</script>", value: 1, seriesName: "Cost", marker: "" },
    ]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;");
  });

  it("金额保留三位小数，避免浮点噪声铺满 tooltip", () => {
    const opt = costTrendOption([row("2026-11-01", 0.123456)], ["#123456"], labels);
    const formatter = formatterOf(opt);
    const html = formatter([
      { name: "11-1", value: 0.123456, seriesName: "Cost", marker: "" },
    ]);
    expect(html).toContain("0.123");
  });
});
