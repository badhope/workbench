import { ArrowRight, FolderOpen, Plus } from "lucide-react";
import { useT } from "../../lib/i18n";
import { dueLabel } from "../../lib/util";
import { explicitNextStep, projectGoal, type ProjectProgress } from "../../lib/workbench";
import { Badge, Btn, Empty } from "../../ui";
import type { Project, Task } from "../../types";
import { ProgressRing } from "../../components/ProgressRing";

function NextAction({ next, onOpen }: { next: Task | null; onOpen: () => void }) {
  const t = useT();
  const due = next ? dueLabel(next.due) : null;
  const step = explicitNextStep(next);
  return (
    <div className="flex items-center gap-3 border-l-2 border-accent/60 pl-3">
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-medium tracking-[0.04em] text-faint">
          {t("today.nextAction")}
        </div>
        {next ? (
          <>
            <button
              type="button"
              onClick={onOpen}
              className="mt-0.5 block w-full truncate text-left text-[13.5px] font-medium hover:text-accent"
            >
              {step || next.title}
            </button>
            {step && (
              <div className="mt-0.5 truncate text-[11px] text-faint">{next.title}</div>
            )}
          </>
        ) : (
          <div className="mt-0.5 text-[12px] text-dim">{t("today.noNextAction")}</div>
        )}
      </div>
      {due && <Badge tone={due.tone}>{due.text}</Badge>}
    </div>
  );
}

export function CurrentProject({
  project,
  progress,
  next,
  onOpenTasks,
  onNewTask,
  onOpenFolder,
  onCreateProject,
  onOpenTask,
}: {
  project: Project | null;
  progress: ProjectProgress | null;
  next: Task | null;
  onOpenTasks: () => void;
  onNewTask: () => void;
  onOpenFolder: () => void;
  onCreateProject: () => void;
  onOpenTask: (id: string) => void;
}) {
  const t = useT();
  if (!project || !progress) {
    return (
      <section className="rounded-[calc(var(--radius-card)+2px)] border border-dashed border-line/80 px-5 py-6">
        <div className="text-[11px] font-medium text-faint">{t("today.current")}</div>
        <Empty
          action={
            <Btn variant="primary" onClick={onCreateProject}>
              <Plus size={13} /> {t("today.createProject")}
            </Btn>
          }
        >
          {t("today.noProjectHint")}
        </Empty>
      </section>
    );
  }
  const statusTone =
    project.status === "active" ? "ok" : project.status === "paused" ? "warn" : "dim";
  const statusLabel =
    project.status === "active"
      ? t("projects.statusActive")
      : project.status === "paused"
        ? t("projects.statusPaused")
        : t("projects.statusArchived");
  return (
    <section className="relative overflow-hidden rounded-[calc(var(--radius-card)+2px)] border border-line/80 bg-panel p-5">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-accent/10 blur-3xl"
      />
      <div className="relative flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-faint">{t("today.current")}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="truncate text-[24px] font-semibold tracking-[-0.025em]">
                {project.name}
              </h2>
              <Badge tone={statusTone}>{statusLabel}</Badge>
              {progress.overdue > 0 && (
                <Badge tone="danger">
                  {t("projects.overdueCount", { count: progress.overdue })}
                </Badge>
              )}
            </div>
            <p className="mt-1 line-clamp-2 max-w-[52ch] text-[12.5px] leading-relaxed text-dim">
              {projectGoal(project) || t("projects.noGoal")}
            </p>
          </div>
          <ProgressRing
            percent={progress.percent}
            size={72}
            strokeWidth={6}
            label={`${progress.done}/${progress.total}`}
          />
        </div>

        <NextAction next={next} onOpen={() => next && onOpenTask(next.id)} />

        <div className="flex flex-wrap gap-1.5">
          <Btn variant="primary" onClick={onOpenTasks}>
            {t("today.continue")} <ArrowRight size={13} />
          </Btn>
          <Btn onClick={onNewTask}>
            <Plus size={13} /> {t("today.newTask")}
          </Btn>
          {project.path && (
            <Btn onClick={onOpenFolder}>
              <FolderOpen size={13} /> {t("today.openFolder")}
            </Btn>
          )}
        </div>
      </div>
    </section>
  );
}
