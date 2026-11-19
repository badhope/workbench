import { useMemo } from "react";
import { ArrowUpRight } from "lucide-react";
import { chartTheme } from "../../lib/chartTheme";
import { useT } from "../../lib/i18n";
import { projectProgress } from "../../lib/workbench";
import { useStore } from "../../lib/store";
import type { Project, Task } from "../../types";
import { AnimatedNumber } from "../../components/live/AnimatedNumber";
import { DistributionBar } from "../../components/live/StatStrip";
import { ProgressRing } from "../../components/ProgressRing";

/**
 * 项目组合脉搏：把散落在项目卡片里的进度、状态、任务量收成一张总览。
 * 不复制底层数据，所有数字仍由 projectProgress 从同一份 tasks 计算。
 */
export function PortfolioPulse({
  projects,
  tasks,
  onOpenTasks,
}: {
  projects: Project[];
  tasks: Task[];
  onOpenTasks: (projectId: string) => void;
}) {
  const t = useT();
  const theme = useStore((s) => s.theme);
  const colors = chartTheme(theme);

  const rows = useMemo(
    () =>
      projects
        .map((project) => ({
          project,
          progress: projectProgress(project.id, tasks),
        }))
        .sort((a, b) => b.progress.total - a.progress.total),
    [projects, tasks]
  );

  const total = rows.reduce((sum, row) => sum + row.progress.total, 0);
  const done = rows.reduce((sum, row) => sum + row.progress.done, 0);
  const percent = total > 0 ? (done / total) * 100 : 0;
  const active = projects.filter((project) => project.status === "active").length;
  const paused = projects.filter((project) => project.status === "paused").length;
  const archived = projects.filter((project) => project.status === "archived").length;
  const top = rows.filter((row) => row.progress.total > 0).slice(0, 3);

  return (
    <section className="rounded-[var(--radius-card)] border border-line/80 bg-panel/80 px-3.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[10.5px] font-medium tracking-[0.05em] text-faint">
            {t("projects.portfolioTitle")}
          </div>
          <div className="mt-0.5 text-[11px] text-dim">{t("projects.portfolioSub")}</div>
        </div>
        <span className="rounded-full border border-line/70 bg-panel2/60 px-2 py-0.5 text-[10px] text-dim">
          {t("projects.totalCount", { count: projects.length })}
        </span>
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.15fr)]">
        <div className="flex items-center gap-3">
          <ProgressRing percent={percent} size={66} strokeWidth={6} />
          <div className="min-w-0">
            <div className="text-[9.5px] text-faint">
              {t("projects.overallCompletion")}
            </div>
            <div className="mt-0.5 leading-none">
              <AnimatedNumber
                value={done}
                className="text-[25px] font-semibold tracking-[-0.04em]"
              />
              <span className="ml-0.5 text-[12px] text-faint">/ {total}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[9.5px] text-dim">
              <span className="text-ok">
                {t("projects.activeCount", { count: active })}
              </span>
              <span className="text-faint">·</span>
              <span>
                {t("projects.statusPaused")} {paused}
              </span>
              <span className="text-faint">·</span>
              <span>
                {t("projects.statusArchived")} {archived}
              </span>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[9.5px] text-faint">
            {t("projects.statusDistTitle")}
          </div>
          <DistributionBar
            segments={[
              {
                key: "active",
                label: t("projects.statusActive"),
                count: active,
                color: colors.ok,
              },
              {
                key: "paused",
                label: t("projects.statusPaused"),
                count: paused,
                color: colors.warn,
              },
              {
                key: "archived",
                label: t("projects.statusArchived"),
                count: archived,
                color: colors.dim,
              },
            ]}
          />
        </div>

        <div className="min-w-0">
          <div className="mb-1.5 text-[9.5px] text-faint">
            {t("projects.topTasksTitle")}
          </div>
          {top.length === 0 ? (
            <div className="text-[10px] text-faint">{t("projects.noLinkedTasks")}</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {top.map(({ project, progress }) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => onOpenTasks(project.id)}
                  className="group flex items-center gap-2 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[10.5px] text-dim group-hover:text-text">
                        {project.name}
                      </span>
                      <span className="num shrink-0 text-[9.5px] text-faint">
                        {progress.done}/{progress.total}
                      </span>
                    </span>
                    <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-bg">
                      <span
                        className="block h-full rounded-full bg-accent/80"
                        style={{ width: `${progress.percent}%` }}
                      />
                    </span>
                  </span>
                  <ArrowUpRight
                    size={11}
                    className="shrink-0 text-faint group-hover:text-accent"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
