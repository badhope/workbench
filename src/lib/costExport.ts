import type { CostExportRow } from "../types";
import { toCsv } from "./export";

/**
 * 成本台账导出：把原始记录变成可直接落盘的 CSV / JSON 文本。
 *
 * 单独成模块的原因：CSV 转义是安全面（公式注入），列顺序是契约
 * （用户会拿它做透视），这些都不该散在组件里。
 */

export const COST_EXPORT_COLUMNS = [
  "day",
  "project",
  "tool",
  "model",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_creation_tokens",
  "cost_input",
  "cost_output",
  "cost_total",
  "cost_source",
  "file_path",
] as const;

/** RFC 4180 CSV：表头 + 行，金额保留全精度（用字符串直接拼，不经 toFixed）。 */
export function buildCostCsv(rows: CostExportRow[]): string {
  const header = COST_EXPORT_COLUMNS as readonly string[];
  const body = rows.map((r) =>
    header.map((col) => {
      const v = r[col as keyof CostExportRow];
      return typeof v === "number" ? String(v) : (v as string | number | null);
    })
  );
  return toCsv([header, ...body] as (string | number)[][]);
}

/** JSON 导出：字段名与 CSV 列一致，方便程序化消费。 */
export function buildCostJson(rows: CostExportRow[]): string {
  return JSON.stringify(rows, null, 2);
}

/** 导出文件名：workbench-costs-20261103.csv。 */
export function costExportFilename(ext: "csv" | "json"): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `workbench-costs-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.${ext}`;
}
