import type { ProcInfo } from "../types";

export type ProcSortKey = "cpu" | "memory" | "pid" | "name";

export interface ProcFilter {
  query: string;
  chip: "all" | "ai" | "dev";
  sort: ProcSortKey;
  aiPids: Set<number>;
  devPids: Set<number>;
}

/**
 * 进程表的筛选 + 排序。
 *
 * 抽成纯函数的原因：这段逻辑原先内联在页面里，`Processes` 的圈复杂度
 * 14（红线 10），而且「搜 PID」「搜命令行」「chip 与搜索叠加」这些
 * 组合只能靠手点验证。纯函数可以单测每一种组合。
 */
export function filterProcs(procs: ProcInfo[], f: ProcFilter): ProcInfo[] {
  const query = f.query.trim().toLowerCase();
  const byChip = procs.filter((p) => matchesChip(p, f));
  const list = query ? byChip.filter((p) => matchesQuery(p, query)) : byChip;
  return [...list].sort((a, b) => compareProcs(a, b, f.sort));
}

function matchesChip(p: ProcInfo, f: ProcFilter): boolean {
  if (f.chip === "ai") return f.aiPids.has(p.pid);
  if (f.chip === "dev") return f.devPids.has(p.pid);
  return true;
}

function matchesQuery(p: ProcInfo, query: string): boolean {
  return (
    p.name.toLowerCase().includes(query) ||
    p.pid.toString().includes(query) ||
    p.cmd_line.toLowerCase().includes(query) ||
    p.exe_path.toLowerCase().includes(query)
  );
}

export function compareProcs(a: ProcInfo, b: ProcInfo, sort: ProcSortKey): number {
  if (sort === "name") return a.name.localeCompare(b.name);
  if (sort === "pid") return a.pid - b.pid;
  return b[sort] - a[sort];
}
