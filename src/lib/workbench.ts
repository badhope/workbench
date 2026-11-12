/**
 * 工作台视图的纯函数：日期范围、注意力计数、项目进度与下一步。
 *
 * 这些逻辑刻意放在 UI 之外，便于单测，也避免首页和任务页各写一套口径。
 * 所有日期比较按本地日历日，不使用「时长差」——否则今天 23:59 与现在
 * 00:01 会被算成不同的一天。
 */
import dayjs from "dayjs";
import type { Project, Task } from "../types";

export type TaskScope = "all" | "today" | "week" | "inbox";

export function isOpenTask(task: Task): boolean {
  return task.status !== "done";
}

function dueDay(task: Task): dayjs.Dayjs | null {
  if (!task.due) return null;
  const d = dayjs(task.due);
  return d.isValid() ? d.startOf("day") : null;
}

export function isOverdue(task: Task, now = dayjs()): boolean {
  if (!isOpenTask(task)) return false;
  const d = dueDay(task);
  return d ? d.isBefore(now.startOf("day"), "day") : false;
}

export function isDueToday(task: Task, now = dayjs()): boolean {
  if (!isOpenTask(task)) return false;
  const d = dueDay(task);
  return d ? d.isSame(now.startOf("day"), "day") : false;
}

export function isDueThisWeek(task: Task, now = dayjs()): boolean {
  if (!isOpenTask(task)) return false;
  const d = dueDay(task);
  if (!d) return false;
  const start = now.startOf("day");
  const end = start.add(7, "day").endOf("day");
  return !d.isBefore(start, "day") && !d.isAfter(end, "day");
}

/** 任务页/首页共用的范围口径。 */
export function taskMatchesScope(task: Task, scope: TaskScope, now = dayjs()): boolean {
  switch (scope) {
    case "today":
      return (
        isOpenTask(task) &&
        (isOverdue(task, now) || isDueToday(task, now) || task.status === "doing")
      );
    case "week":
      return isDueThisWeek(task, now) || isOverdue(task, now);
    case "inbox":
      return isOpenTask(task) && !task.project_id;
    case "all":
    default:
      return true;
  }
}

const PRIORITY_WEIGHT: Record<string, number> = { high: 0, normal: 1, low: 2 };

/**
 * 「下一步」排序：逾期/更早到期优先，无日期最后；同日按优先级，再按更新时间。
 * 不修改原数组。
 */
export function sortTasksForWork(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const ad = dueDay(a)?.valueOf() ?? Number.POSITIVE_INFINITY;
    const bd = dueDay(b)?.valueOf() ?? Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    const ap = PRIORITY_WEIGHT[a.priority] ?? 1;
    const bp = PRIORITY_WEIGHT[b.priority] ?? 1;
    if (ap !== bp) return ap - bp;
    return b.updated_at - a.updated_at;
  });
}

export function openTasks(tasks: Task[]): Task[] {
  return sortTasksForWork(tasks.filter(isOpenTask));
}

/** 首页「今天」列表：逾期、今天到期、进行中；去重后排序。 */
export function tasksForToday(tasks: Task[], now = dayjs()): Task[] {
  const seen = new Set<string>();
  const picked: Task[] = [];
  for (const task of sortTasksForWork(tasks.filter(isOpenTask))) {
    if (
      isOverdue(task, now) ||
      isDueToday(task, now) ||
      task.status === "doing"
    ) {
      if (!seen.has(task.id)) {
        seen.add(task.id);
        picked.push(task);
      }
    }
  }
  return picked;
}

export interface ProjectProgress {
  total: number;
  done: number;
  open: number;
  overdue: number;
  percent: number;
}

export function projectProgress(projectId: string, tasks: Task[], now = dayjs()): ProjectProgress {
  const own = tasks.filter((t) => t.project_id === projectId);
  const done = own.filter((t) => t.status === "done").length;
  const overdue = own.filter((t) => isOverdue(t, now)).length;
  const total = own.length;
  return {
    total,
    done,
    open: total - done,
    overdue,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}

/** 项目下一步：未完成任务中排序最靠前的一项。 */
export function nextTaskForProject(projectId: string, tasks: Task[]): Task | null {
  return (
    sortTasksForWork(
      tasks.filter((t) => t.project_id === projectId && isOpenTask(t))
    )[0] ?? null
  );
}

/**
 * 首页「当前项目」：
 * 1. 置顶项目（按创建时间新→旧）
 * 2. 有未完成任务的最近更新项目
 * 3. 最近创建的项目
 */
export function pickCurrentProject(projects: Project[], tasks: Task[]): Project | null {
  if (projects.length === 0) return null;
  const pinned = projects
    .filter((p) => p.pinned)
    .sort((a, b) => b.created_at - a.created_at);
  if (pinned.length > 0) return pinned[0];

  const latestByProject = new Map<string, number>();
  for (const t of tasks) {
    if (!t.project_id || !isOpenTask(t)) continue;
    const current = latestByProject.get(t.project_id) ?? 0;
    if (t.updated_at > current) latestByProject.set(t.project_id, t.updated_at);
  }
  let best: Project | null = null;
  let bestAt = -1;
  for (const p of projects) {
    const at = latestByProject.get(p.id) ?? 0;
    if (at > bestAt) {
      best = p;
      bestAt = at;
    }
  }
  if (best && bestAt > 0) return best;
  return [...projects].sort((a, b) => b.created_at - a.created_at)[0] ?? null;
}

export interface AttentionCounts {
  overdue: number;
  today: number;
  doing: number;
  inbox: number;
}

export function attentionCounts(tasks: Task[], now = dayjs()): AttentionCounts {
  return {
    overdue: tasks.filter((t) => isOverdue(t, now)).length,
    today: tasks.filter((t) => isDueToday(t, now)).length,
    doing: tasks.filter((t) => isOpenTask(t) && t.status === "doing").length,
    inbox: tasks.filter((t) => isOpenTask(t) && !t.project_id).length,
  };
}

/** 最近更新的任务（用于「最近」）。 */
export function recentTasks(tasks: Task[], limit = 4): Task[] {
  return [...tasks].sort((a, b) => b.updated_at - a.updated_at).slice(0, limit);
}
