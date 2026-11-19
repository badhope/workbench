/**
 * 表格导出。CSV 是唯一一种「双击就能在 Excel/Numbers 打开」的格式，
 * 因此也是注入面最大的格式：以 = + - @ 开头的单元格会被 Excel 当公式执行。
 * 这里统一加单引号前缀（业界通行做法），并把逗号/引号/换行整体引用。
 */
export type CsvValue = string | number | boolean | null | undefined;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function toCsv(rows: CsvValue[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** 文件名安全的时间戳：2026-11-19T10-30-00。 */
export function timestampForFilename(date = new Date()): string {
  return date.toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

/** CSV 导出 + 统一文件名时间戳，避免每个页面各拼一遍。 */
export function downloadCsv(name: string, rows: CsvValue[][], at = new Date()): void {
  downloadText(`workbench-${name}-${timestampForFilename(at)}.csv`, toCsv(rows));
}

/** 触发浏览器/WebView 下载。不依赖 Tauri 的文件对话框，离线可用。 */
export function downloadText(filename: string, text: string, mime = "text/csv"): void {
  const blob = new Blob([`\ufeff${text}`], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
