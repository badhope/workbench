/**
 * 进程表列定义。
 *
 * 顺序即渲染顺序；expand 箭头列固定在最前，不参与显示/隐藏与排序。
 * 放在 lib 而不是页面目录，是因为 store 的持久化迁移也要清洗同一份 id 集。
 */
export const PROC_COLUMNS = [
  "pid",
  "name",
  "cpu",
  "memory",
  "status",
  "started",
  "path",
  "action",
] as const;

export type ProcColumnId = (typeof PROC_COLUMNS)[number];

export const DEFAULT_PROC_COLUMNS: ProcColumnId[] = [...PROC_COLUMNS];

/** 持久化/旧版本数据清洗：只保留已知 id、去重、至少保留一列。 */
export function sanitizeProcColumns(value: unknown): ProcColumnId[] {
  if (!Array.isArray(value)) return DEFAULT_PROC_COLUMNS;
  const known = new Set<string>(PROC_COLUMNS);
  const out = value.filter(
    (id, index): id is ProcColumnId =>
      typeof id === "string" && known.has(id) && value.indexOf(id) === index
  );
  return out.length > 0 ? out : DEFAULT_PROC_COLUMNS;
}

/** 菜单重排：把某一列上/下移一位；返回新数组，不原地修改。 */
export function moveProcColumn(
  columns: ProcColumnId[],
  id: ProcColumnId,
  direction: -1 | 1
): ProcColumnId[] {
  const index = columns.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= columns.length) return columns;
  const next = [...columns];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
