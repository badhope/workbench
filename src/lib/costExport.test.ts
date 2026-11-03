import { describe, expect, it } from "vitest";
import { buildCostCsv, buildCostJson, costExportFilename } from "./costExport";
import type { CostExportRow } from "../types";

const row = (over: Partial<CostExportRow>): CostExportRow => ({
  day: "2026-05-01",
  project: "web",
  tool: "Claude Code",
  model: "claude-sonnet-4-5",
  input_tokens: 100,
  output_tokens: 50,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  cost_input: 0.001,
  cost_output: 0.0025,
  cost_total: 0.0035,
  cost_source: "measured",
  file_path: "/home/me/.claude/projects/web/a.jsonl",
  ...over,
});

describe("成本台账导出", () => {
  it("CSV 表头列序固定（这是用户的透视契约）", () => {
    const csv = buildCostCsv([row({})]);
    const header = csv.split("\r\n")[0];
    expect(header).toBe(
      "day,project,tool,model,input_tokens,output_tokens,cache_read_tokens,cache_creation_tokens,cost_input,cost_output,cost_total,cost_source,file_path"
    );
  });

  it("CSV 对含逗号/引号/公式注入的单元格正确转义", () => {
    const csv = buildCostCsv([
      row({ project: 'a,b"c', file_path: '=HYPERLINK("http://evil")' }),
    ]);
    expect(csv).toContain('"a,b""c"');
    expect(csv).toContain("'=HYPERLINK");
  });

  it("金额不经 toFixed：全精度进 CSV，避免对账时对不上", () => {
    const csv = buildCostCsv([row({ cost_total: 0.0035001 })]);
    expect(csv).toContain("0.0035001");
  });

  it("JSON 是行数组的 pretty 序列化，字段名与 CSV 列一致", () => {
    const json = buildCostJson([row({})]);
    const parsed = JSON.parse(json) as CostExportRow[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].cost_total).toBeCloseTo(0.0035);
    expect(Object.keys(parsed[0])).toContain("cost_source");
  });

  it("文件名带日期与扩展名", () => {
    expect(costExportFilename("csv")).toMatch(/^workbench-costs-\d{8}\.csv$/);
    expect(costExportFilename("json")).toMatch(/^workbench-costs-\d{8}\.json$/);
  });
});
