import { FIXED_COLORS } from "../../lib/chartTheme";

/** 任务状态的唯一视觉定义：看板列、分布条和筛选共用，避免三套颜色/文案。 */
export const TASK_STATUSES = [
  { key: "todo", color: FIXED_COLORS.other, labelKey: "tasks.colTodo" },
  { key: "doing", color: FIXED_COLORS.normal, labelKey: "tasks.colDoing" },
  { key: "done", color: FIXED_COLORS.system, labelKey: "tasks.colDone" },
] as const;

export function taskStatusLabel(key: string, t: (key: string) => string): string {
  const row = TASK_STATUSES.find((status) => status.key === key);
  return row ? t(row.labelKey) : key;
}
