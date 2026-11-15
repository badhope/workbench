import { describe, expect, it } from "vitest";
import { fuzzyScore, rankCommands } from "./commandSearch";

describe("fuzzyScore", () => {
  it("returns 0 when characters are missing or out of order", () => {
    expect(fuzzyScore("zzz", "processes")).toBe(0);
    expect(fuzzyScore("ps", "processes")).toBeGreaterThan(0);
    expect(fuzzyScore("sp", "processes")).toBe(0);
  });

  it("rewards prefix and word-boundary matches", () => {
    expect(fuzzyScore("proc", "Processes")).toBeGreaterThan(
      fuzzyScore("proc", "All processes")
    );
    expect(fuzzyScore("cost", "Cost ledger")).toBeGreaterThan(
      fuzzyScore("cost", "A cost ledger")
    );
  });

  it("is case insensitive", () => {
    expect(fuzzyScore("COST", "costs")).toBeGreaterThan(0);
  });
});

describe("rankCommands", () => {
  const items = [
    { id: "a", label: "Overview", keywords: "dashboard home" },
    { id: "b", label: "Cost ledger", keywords: "spend budget" },
    { id: "c", label: "Processes", keywords: "cpu memory" },
  ];

  it("keeps registration order for an empty query", () => {
    expect(rankCommands(items, "").map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("puts the best match first", () => {
    expect(rankCommands(items, "cost").map((x) => x.id)).toEqual(["b"]);
  });

  it("searches keywords too", () => {
    expect(rankCommands(items, "budget").map((x) => x.id)).toEqual(["b"]);
  });

  it("respects the limit", () => {
    expect(rankCommands(items, "", 2)).toHaveLength(2);
  });

  /**
   * 回归：搜 `cost` 时，十几个 conhost.exe 曾靠散字母子序列命中把
   * 「成本账本」页挤出前 12（真实截图里 12 条结果全是 conhost.exe）。
   * 连续/前缀匹配必须无条件压过散字母匹配。
   */
  it("never lets subsequence noise outrank a real prefix match", () => {
    const noisy = Array.from({ length: 30 }, (_, i) => ({
      id: `proc-${i}`,
      label: `conhost.exe · ${1000 + i}`,
      keywords: `${1000 + i} C:\\Windows\\system32\\conhost.exe`,
    }));
    const real = [
      { id: "nav-costs", label: "成本账本", keywords: "costs ledger" },
      { id: "nav-costs-en", label: "Cost ledger", keywords: "costs spend" },
    ];
    const ranked = rankCommands([...noisy, ...real], "cost", 12);
    const firstReal = ranked.findIndex((x) => x.id.startsWith("nav-"));
    expect(firstReal).toBe(0);
    expect(ranked.filter((x) => x.id.startsWith("nav-"))).toHaveLength(2);
  });

  it("keeps word-start and contains matches above subsequences", () => {
    const items = [
      { id: "sub", label: "c_o_s_t artifact" },
      { id: "contains", label: "my costs" },
      { id: "word", label: "Cost ledger" },
    ];
    expect(rankCommands(items, "cost").map((x) => x.id)).toEqual([
      "word",
      "contains",
      "sub",
    ]);
  });
});
