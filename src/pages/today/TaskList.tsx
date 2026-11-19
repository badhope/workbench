import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { useT } from "../../lib/i18n";
import { dueLabel } from "../../lib/util";
import { isBlocked } from "../../lib/workbench";
import { Badge, Empty } from "../../ui";
import type { Project, Task } from "../../types";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

function priorityLabel(key: string, t: Translate): string {
  if (key === "low") return t("tasks.priorityLow");
  if (key === "high") return t("tasks.priorityHigh");
  return t("tasks.priorityNormal");
}

export function TaskRow({
  task,
  projectName,
  onComplete,
  onOpen,
  compact = false,
}: {
  task: Task;
  projectName: string | null;
  onComplete: () => void;
  onOpen: () => void;
  compact?: boolean;
}) {
  const t = useT();
  const due = dueLabel(task.due);
  return (
    <li className="group flex items-center gap-2 rounded-[var(--radius-btn)] border-b border-line/50 px-1 py-2 transition-colors last:border-0 hover:bg-panel2/50">
      <button
        type="button"
        onClick={onComplete}
        aria-label={t("today.markDone")}
        title={t("today.markDone")}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-dim/50 text-transparent transition-colors hover:border-ok hover:text-ok"
      >
        <Check size={11} strokeWidth={3} />
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 truncate text-left text-[12.5px] hover:text-accent"
      >
        {task.title}
      </button>
      {!compact && projectName && (
        <span className="hidden max-w-[110px] truncate text-[10.5px] text-faint sm:inline">
          {projectName}
        </span>
      )}
      <span className="hidden text-[10px] text-faint sm:inline">
        {priorityLabel(task.priority, t)}
      </span>
      {isBlocked(task) && <Badge tone="danger">{t("tasks.blocked")}</Badge>}
      <Badge tone={due.tone}>{due.text}</Badge>
    </li>
  );
}

export function TaskList({
  title,
  tasks,
  projects,
  totalCount,
  emptyText,
  emptyAction,
  extra,
  onComplete,
  onOpen,
}: {
  title: string;
  tasks: Task[];
  projects: Project[];
  totalCount?: number;
  emptyText?: string;
  emptyAction?: ReactNode;
  extra?: ReactNode;
  onComplete: (id: string) => void;
  onOpen: (task: Task) => void;
}) {
  const t = useT();
  const shown = totalCount ?? tasks.length;
  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3 border-b border-line/70 pb-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[14px] font-semibold">{title}</h2>
          {shown > 0 && <span className="num text-[10.5px] text-faint">{shown}</span>}
        </div>
        {extra}
      </div>
      {tasks.length === 0 ? (
        <Empty action={emptyAction}>{emptyText ?? t("today.noTasks")}</Empty>
      ) : (
        <ul className="flex flex-col">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              projectName={projects.find((p) => p.id === task.project_id)?.name ?? null}
              onComplete={() => onComplete(task.id)}
              onOpen={() => onOpen(task)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
