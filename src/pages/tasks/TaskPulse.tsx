import { X } from "lucide-react";
import { ProgressRing } from "../../components/ProgressRing";
import { FIXED_COLORS } from "../../lib/chartTheme";
import { useT } from "../../lib/i18n";
import type { Task } from "../../types";
import { TASK_STATUSES, taskStatusLabel } from "./taskVisuals";

const PRIORITIES = [
  { key: "low", color: FIXED_COLORS.low, labelKey: "tasks.priorityLow" },
  { key: "normal", color: FIXED_COLORS.normal, labelKey: "tasks.priorityNormal" },
  { key: "high", color: FIXED_COLORS.high, labelKey: "tasks.priorityHigh" },
] as const;

/**
 * 任务脉冲：完成率、状态分布、优先级分布压成一条常驻摘要。
 *
 * 三段不是三个独立大卡：它们共享同一份当前范围数据，切换范围/项目/搜索时
 * 一起更新。状态段可直接点击筛选，第二次点击或「清除筛选」恢复全部。
 * 视觉只做“一眼看懂”，详细任务仍在下面的列表/看板里。
 */
export function TaskPulse({
  tasks,
  statusFilter,
  onStatusFilter,
}: {
  tasks: Task[];
  statusFilter: string | null;
  onStatusFilter: (status: string | null) => void;
}) {
  const t = useT();
  const statusCounts = TASK_STATUSES.map((status) => ({
    ...status,
    count: tasks.filter((task) => task.status === status.key).length,
  }));
  const priorityCounts = PRIORITIES.map((priority) => ({
    ...priority,
    count: tasks.filter((task) => task.priority === priority.key).length,
  }));
  const done = statusCounts.find((status) => status.key === "done")?.count ?? 0;
  const total = tasks.length;
  const percent = total > 0 ? (done / total) * 100 : 0;

  return (
    <section
      aria-label={t("tasks.taskDist")}
      className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[var(--radius-card)] border border-line/80 bg-panel px-4 py-2.5"
    >
      <div className="flex items-center gap-2.5">
        <ProgressRing percent={percent} size={42} strokeWidth={4} />
        <div>
          <div className="text-[10px] text-faint">{t("tasks.completionRate")}</div>
          <div className="num mt-0.5 text-[12px]">
            <span className="text-ok">{done}</span>
            <span className="text-faint"> / {total}</span>
          </div>
        </div>
      </div>

      <span className="hidden h-8 w-px bg-line/60 sm:block" aria-hidden="true" />

      <div className="min-w-[160px] flex-1">
        <div className="flex items-baseline justify-between gap-2 text-[10px] text-faint">
          <span>{t("tasks.taskDist")}</span>
          <span className="num">{total}</span>
        </div>
        <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-bg">
          {statusCounts
            .filter((status) => status.count > 0)
            .map((status) => (
              <button
                key={status.key}
                type="button"
                aria-label={`${t("tasks.taskDist")}: ${taskStatusLabel(status.key, t)}`}
                aria-pressed={statusFilter === status.key}
                title={`${taskStatusLabel(status.key, t)} · ${status.count}`}
                onClick={() =>
                  onStatusFilter(statusFilter === status.key ? null : status.key)
                }
                className="h-full min-w-[3px] cursor-pointer transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                style={{
                  flexGrow: status.count,
                  backgroundColor: status.color,
                  opacity: statusFilter && statusFilter !== status.key ? 0.35 : 1,
                }}
              />
            ))}
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {statusCounts.map((status) => (
            <button
              key={status.key}
              type="button"
              aria-label={`${taskStatusLabel(status.key, t)}: ${status.count}`}
              aria-pressed={statusFilter === status.key}
              onClick={() =>
                onStatusFilter(statusFilter === status.key ? null : status.key)
              }
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] transition-colors ${
                statusFilter === status.key
                  ? "border-accent/70 bg-accent/10 text-text"
                  : "border-line/70 text-dim hover:border-accent/40 hover:text-text"
              }`}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: status.color }}
              />
              {taskStatusLabel(status.key, t)}
              <span className="num text-[10px] text-faint">{status.count}</span>
            </button>
          ))}
        </div>
      </div>

      <span className="hidden h-8 w-px bg-line/60 sm:block" aria-hidden="true" />

      <div className="min-w-[120px]">
        <div className="text-[10px] text-faint">{t("tasks.priorityDist")}</div>
        <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-bg">
          {priorityCounts
            .filter((priority) => priority.count > 0)
            .map((priority) => (
              <div
                key={priority.key}
                title={`${t(priority.labelKey)} · ${priority.count}`}
                style={{ flexGrow: priority.count, backgroundColor: priority.color }}
              />
            ))}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-dim">
          {priorityCounts.map((priority) => (
            <span
              key={priority.key}
              className="inline-flex items-center gap-1"
              title={`${t(priority.labelKey)} · ${priority.count}`}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: priority.color }}
              />
              {t(priority.labelKey)}
              <span className="num text-text">{priority.count}</span>
            </span>
          ))}
        </div>
      </div>

      {statusFilter && (
        <button
          type="button"
          onClick={() => onStatusFilter(null)}
          className="inline-flex items-center gap-1 rounded-full border border-line/70 px-2 py-0.5 text-[10.5px] text-dim transition-colors hover:border-accent/50 hover:text-text"
        >
          <X size={11} />
          {t("tasks.clearFilter")}
        </button>
      )}
    </section>
  );
}
