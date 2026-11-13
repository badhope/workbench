import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { EChart } from "../lib/echarts";
import { chartGapColor, chartTheme, FIXED_COLORS, horizontalBarOption } from "../lib/chartTheme";
import { useStore } from "../lib/store";
import { useShallow } from "zustand/react/shallow";
import { useT } from "../lib/i18n";
import { Btn, Empty, SectionTitle } from "../ui";
import { ProgressRing } from "../components/ProgressRing";
import {
  completionTrend,
  isOpenTask,
  isOverdue,
  projectProgress,
} from "../lib/workbench";
import { formatTime } from "../lib/util";

const STATUS_ORDER = ["todo", "doing", "done"] as const;
const PRIORITY_ORDER = ["high", "normal", "low"] as const;

const STATUS_COLORS: Record<string, string> = {
  todo: FIXED_COLORS.other,
  doing: FIXED_COLORS.normal,
  done: FIXED_COLORS.system,
};

/**
 * 回顾页：把任务/项目的当前状态集中到一处。
 *
 * 完成趋势只统计 `completed_at`：这是 v2 才有的字段，旧任务没有，
 * 迁移时刻意不拿 `updated_at` 冒充完成时间。数据从升级之后开始累积，
 * 界面上要如实说明这一点，而不是假装历史一直都有。
 */
export default function Review() {
  const t = useT();
  const { data, theme, lastDataUpdatedAt, setView, setTaskProjectFilter, setTaskScope } = useStore(
    useShallow((s) => ({
      data: s.data,
      theme: s.theme,
      lastDataUpdatedAt: s.lastDataUpdatedAt,
      setView: s.setView,
      setTaskProjectFilter: s.setTaskProjectFilter,
      setTaskScope: s.setTaskScope,
    }))
  );

  const stats = useMemo(() => {
    const total = data.tasks.length;
    const done = data.tasks.filter((task) => task.status === "done").length;
    const open = data.tasks.filter(isOpenTask).length;
    const overdue = data.tasks.filter((task) => isOverdue(task)).length;
    return {
      total,
      done,
      open,
      overdue,
      percent: total ? Math.round((done / total) * 100) : 0,
    };
  }, [data.tasks]);

  const statusData = useMemo(
    () =>
      STATUS_ORDER.map((status) => ({
        name:
          status === "todo"
            ? t("tasks.colTodo")
            : status === "doing"
              ? t("tasks.colDoing")
              : t("tasks.colDone"),
        value: data.tasks.filter((task) => task.status === status).length,
        color: STATUS_COLORS[status],
      })).filter((item) => item.value > 0),
    [data.tasks, t]
  );

  const priorityData = useMemo(
    () =>
      PRIORITY_ORDER.map((priority) => ({
        key: priority,
        name:
          priority === "high"
            ? t("tasks.priorityHigh")
            : priority === "normal"
              ? t("tasks.priorityNormal")
              : t("tasks.priorityLow"),
        value: data.tasks.filter(
          (task) => isOpenTask(task) && task.priority === priority
        ).length,
        color:
          priority === "high"
            ? FIXED_COLORS.high
            : priority === "normal"
              ? FIXED_COLORS.normal
              : FIXED_COLORS.low,
      })),
    [data.tasks, t]
  );

  const projectRows = useMemo(
    () =>
      [...data.projects]
        .map((project) => ({
          project,
          progress: projectProgress(project.id, data.tasks),
        }))
        .sort((a, b) => b.progress.open - a.progress.open)
        .slice(0, 8),
    [data.projects, data.tasks]
  );

  const trend = useMemo(() => completionTrend(data.tasks, 14), [data.tasks]);
  const hasTrend = trend.some((point) => point.count > 0);

  const trendOption = useMemo(() => {
    const palette = chartTheme(theme);
    return {
      grid: { left: 28, right: 8, top: 12, bottom: 22 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: {
        type: "category",
        data: trend.map((point) => point.label),
        axisLabel: { fontSize: 9, color: palette.dim, interval: 1 },
        axisLine: { lineStyle: { color: palette.line } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { fontSize: 9, color: palette.dim },
        splitLine: { lineStyle: { color: palette.line, opacity: 0.5 } },
      },
      series: [
        {
          type: "bar",
          data: trend.map((point) => point.count),
          barMaxWidth: 18,
          itemStyle: { color: palette.accent, borderRadius: [3, 3, 0, 0] },
        },
      ],
    };
  }, [trend, theme]);

  const statusOption = useMemo(
    () => ({
      tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
      series: [
        {
          type: "pie",
          radius: ["48%", "72%"],
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderColor: chartGapColor(theme), borderWidth: 2 },
          data: statusData.map((item) => ({
            name: item.name,
            value: item.value,
            itemStyle: { color: item.color },
          })),
        },
      ],
    }),
    [statusData, theme]
  );

  const priorityOption = useMemo(
    () =>
      horizontalBarOption({
        labels: priorityData.map((item) => item.name),
        values: priorityData.map((item) => ({
          value: item.value,
          color: item.color,
        })),
        theme,
        left: 64,
        fontSize: 10,
        inverse: true,
        barWidth: 14,
      }),
    [priorityData, theme]
  );

  const openProjectTasks = (projectId: string) => {
    setTaskScope("all");
    setTaskProjectFilter(projectId);
    setView("tasks");
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-line/70 pb-4 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <h1 className="t-heading text-[24px] font-semibold tracking-[-0.03em]">
            {t("review.title")}
          </h1>
          <p className="mt-1 text-[12.5px] text-dim">{t("review.subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-[10.5px] text-faint sm:inline">
            {lastDataUpdatedAt > 0
              ? t("app.dataUpdatedAt", { time: formatTime(lastDataUpdatedAt) })
              : t("app.dataWaiting")}
          </span>
          <Btn
            onClick={() => {
              setTaskScope("all");
              setTaskProjectFilter("");
              setView("tasks");
            }}
          >
            {t("review.viewTasks")} <ArrowRight size={13} />
          </Btn>
        </div>
      </header>

      {data.tasks.length === 0 && data.projects.length === 0 ? (
        <Empty
          action={
            <Btn variant="primary" onClick={() => setView("projects")}>
              {t("today.createProject")}
            </Btn>
          }
        >
          {t("review.empty")}
        </Empty>
      ) : (
        <>
          <section className="flex flex-col gap-5 rounded-[calc(var(--radius-card)+2px)] border border-line/80 bg-panel px-5 py-5 sm:flex-row sm:items-center">
            <ProgressRing
              percent={stats.percent}
              size={104}
              strokeWidth={7}
              label={t("review.ofTotal", { done: stats.done, total: stats.total })}
            />
            <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              <Stat label={t("review.completion")} value={`${stats.percent}%`} />
              <Stat label={t("review.open")} value={stats.open} />
              <Stat label={t("review.overdue")} value={stats.overdue} tone="danger" />
              <Stat label={t("review.projects")} value={data.projects.length} />
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
            <section className="flex flex-col gap-1">
              <div className="flex items-center justify-between border-b border-line/70 pb-2">
                <h2 className="text-[14px] font-semibold">
                  {t("review.projectProgress")}
                </h2>
                <span className="text-[10.5px] text-faint">
                  {t("review.snapshot")}
                </span>
              </div>
              {projectRows.length === 0 ? (
                <div className="py-6 text-center text-[12px] text-faint">
                  {t("review.noProjects")}
                </div>
              ) : (
                <ul className="flex flex-col">
                  {projectRows.map(({ project, progress }) => (
                    <li
                      key={project.id}
                      className="border-b border-line/40 last:border-0"
                    >
                      <button
                        type="button"
                        onClick={() => openProjectTasks(project.id)}
                        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5 text-left transition-colors hover:bg-panel2/40"
                      >
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-[12.5px] font-medium">
                              {project.name}
                            </span>
                            {progress.overdue > 0 && (
                              <span className="shrink-0 text-[10px] text-danger">
                                {t("review.colOverdue")} {progress.overdue}
                              </span>
                            )}
                          </span>
                          <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-bg">
                            <span
                              className="block h-full rounded-full bg-accent/80"
                              style={{ width: `${progress.percent}%` }}
                            />
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="num text-[10.5px] text-faint">
                            {progress.done}/{progress.total}
                          </span>
                          <span className="num w-8 text-right text-[11px] text-dim">
                            {progress.percent}%
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between border-b border-line/70 pb-2">
                <h2 className="text-[14px] font-semibold">{t("review.status")}</h2>
                <span className="text-[10.5px] text-faint">
                  {t("review.statusHint")}
                </span>
              </div>
              {statusData.length === 0 ? (
                <div className="py-6 text-center text-[12px] text-faint">
                  {t("review.empty")}
                </div>
              ) : (
                <>
                  <EChart option={statusOption} style={{ height: 160 }} lazyUpdate />
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {statusData.map((item) => (
                      <span
                        key={item.name}
                        className="flex items-center gap-1 text-[11px] text-dim"
                      >
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ background: item.color }}
                        />
                        {item.name}{" "}
                        <span className="num text-text">{item.value}</span>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between border-b border-line/70 pb-2">
              <h2 className="text-[14px] font-semibold">{t("review.trend")}</h2>
              <span className="text-[10.5px] text-faint">{t("review.trendHint")}</span>
            </div>
            {hasTrend ? (
              <EChart option={trendOption} style={{ height: 150 }} lazyUpdate />
            ) : (
              <div className="py-6 text-center text-[12px] text-faint">
                {t("review.trendEmpty")}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <SectionTitle>{t("review.priority")}</SectionTitle>
            {priorityData.every((item) => item.value === 0) ? (
              <Empty>{t("review.empty")}</Empty>
            ) : (
              <EChart option={priorityOption} style={{ height: 150 }} lazyUpdate />
            )}
          </section>

          <p className="text-[10.5px] text-faint">{t("review.note")}</p>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "danger";
}) {
  return (
    <div>
      <div className="text-[10.5px] text-faint">{label}</div>
      <div
        className={`num mt-0.5 text-[22px] font-semibold leading-none ${
          tone === "danger" ? "text-danger" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
