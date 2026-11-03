import { describe, expect, it } from "vitest";
import { demoBundle } from "./demo";

/**
 * 演示数据只服务浏览器预览模式，但它是截图/演示的门面：
 * 结构契约（新增聚合字段必须存在）与语言回退都要有断言。
 */
describe("演示数据", () => {
  it("未知语言回退到英语，不抛异常", () => {
    // 运行时入参可能被持久化存储污染（类型层面拦不住）
    const b = demoBundle("xx" as never);
    expect(b.data.projects.length).toBeGreaterThan(0);
    expect(b.costOverview.today_cost).toBeGreaterThan(0);
  });

  it("三种语言的 bundle 都带 0.5.0 的新聚合字段", () => {
    for (const lang of ["en", "zh", "ja"] as const) {
      const b = demoBundle(lang);
      expect(b.costProjectBreakdown.length, lang).toBeGreaterThan(0);
      expect(b.costTrendMonthly.length, lang).toBeGreaterThan(0);
      // 月度桶升序，可与日粒度直接拼接
      const months = b.costTrendMonthly.map((m) => m.month);
      expect([...months].sort()).toEqual(months);
    }
  });
});
