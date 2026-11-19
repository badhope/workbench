import type { ReactNode } from "react";
import { Inbox, Plus, Server, Sparkles } from "lucide-react";
import { useT } from "../../lib/i18n";
import type { ProjectProgress } from "../../lib/workbench";
import { Btn, Empty } from "../../ui";
import type { Project, Task } from "../../types";
import { TaskRow } from "./TaskList";

function RailHeader({
  title,
  action,
  onAction,
  icon,
}: {
  title: string;
  action: string;
  onAction: () => void;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.04em] text-faint">
        {icon}
        {title}
      </h2>
      <button
        type="button"
        className="text-[10.5px] text-accent hover:underline"
        onClick={onAction}
      >
        {action}
      </button>
    </div>
  );
}

export function ProjectsRail({
  rows,
  onOpen,
  onViewAll,
  onCreate,
}: {
  rows: { project: Project; progress: ProjectProgress; next: Task | null }[];
  onOpen: (id: string) => void;
  onViewAll: () => void;
  onCreate: () => void;
}) {
  const t = useT();
  return (
    <section>
      <RailHeader
        title={t("today.projects")}
        action={t("today.viewProjects")}
        onAction={onViewAll}
      />
      {rows.length === 0 ? (
        <div className="pt-2">
          <Empty
            action={
              <Btn onClick={onCreate}>
                <Plus size={13} /> {t("today.createProject")}
              </Btn>
            }
          >
            {t("today.noProjectHint")}
          </Empty>
        </div>
      ) : (
        <ul className="flex flex-col">
          {rows.map(({ project, progress, next }) => (
            <li key={project.id} className="border-b border-line/40 last:border-0">
              <button
                type="button"
                onClick={() => onOpen(project.id)}
                className="group flex w-full flex-col gap-1.5 py-2.5 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium group-hover:text-accent">
                    {project.name}
                  </span>
                  <span className="num text-[10px] text-faint">
                    {progress.done}/{progress.total}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-bg">
                  <div
                    className="h-full rounded-full bg-accent/80"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[10.5px] text-dim">
                    {next ? next.title : t("projects.noOpenTasks")}
                  </span>
                  {progress.overdue > 0 && (
                    <span className="text-[10px] text-danger">{progress.overdue}</span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function InboxRail({
  tasks,
  onOpen,
  onComplete,
  onViewAll,
}: {
  tasks: Task[];
  onOpen: (task: Task) => void;
  onComplete: (id: string) => void;
  onViewAll: () => void;
}) {
  const t = useT();
  return (
    <section className="border-t border-line/60 pt-4">
      <RailHeader
        title={t("today.inboxTitle")}
        action={t("today.viewTasks")}
        onAction={onViewAll}
        icon={<Inbox size={12} />}
      />
      {tasks.length === 0 ? (
        <div className="py-2.5">
          <div className="text-[12px] text-dim">{t("today.inboxEmpty")}</div>
          <div className="mt-1 text-[10.5px] text-faint">{t("today.inboxHint")}</div>
        </div>
      ) : (
        <ul className="flex flex-col">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              projectName={null}
              onComplete={() => onComplete(task.id)}
              onOpen={() => onOpen(task)}
              compact
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function SystemRail({
  devs,
  ports,
  ais,
  error,
  onOpen,
}: {
  devs: number;
  ports: number;
  ais: number;
  error: string;
  onOpen: () => void;
}) {
  const t = useT();
  return (
    <section className="border-t border-line/60 pt-4">
      <RailHeader
        title={t("today.system")}
        action={t("today.openTools")}
        onAction={onOpen}
      />
      {error ? (
        <div className="mt-2 rounded-[var(--radius-btn)] border border-danger/30 bg-danger/8 px-2.5 py-2 text-[11px] text-danger">
          {t("today.systemError", { err: error })}
        </div>
      ) : (
        <ul className="mt-1 flex flex-col gap-2 text-[11.5px]">
          <li className="flex items-center gap-2">
            <Server size={12} className="text-ok" />
            <span className="flex-1 text-dim">
              {t("today.services", { count: devs })}
            </span>
          </li>
          <li className="flex items-center gap-2">
            <span className="flex h-3 w-3 items-center justify-center text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            <span className="flex-1 text-dim">{t("today.ports", { count: ports })}</span>
          </li>
          <li className="flex items-center gap-2">
            <Sparkles size={12} className="text-warn" />
            <span className="flex-1 text-dim">
              {t("today.aiProcesses", { count: ais })}
            </span>
          </li>
        </ul>
      )}
    </section>
  );
}
