import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowUpRight, CircleDot } from "lucide-react";
import { chartTheme } from "../../lib/chartTheme";
import { useLang, useT, localeFor } from "../../lib/i18n";
import { useStore } from "../../lib/store";
import { formatTime, formatUsd } from "../../lib/util";
import { useShallow } from "zustand/react/shallow";
import { AnimatedNumber } from "../../components/live/AnimatedNumber";
import { LiveSparkline } from "../../components/live/LiveSparkline";
import { ProgressRing } from "../../components/ProgressRing";

function LiveDot({ className = "text-accent" }: { className?: string }) {
  return (
    <span className={`relative flex h-2 w-2 shrink-0 ${className}`} aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
    </span>
  );
}

function LiveCard({
  title,
  tone,
  onOpen,
  children,
  className = "",
}: {
  title: string;
  tone: string;
  onOpen: () => void;
  children: ReactNode;
  className?: string;
}) {
  const t = useT();
  return (
    <section
      className={`live-card group relative overflow-hidden rounded-[var(--radius-card)] border border-line/80 bg-panel/75 px-3.5 py-3 ${className}`}
    >
      <div
        className="pointer-events-none absolute -right-16 -top-20 h-40 w-40 rounded-full opacity-[0.14] blur-2xl transition-opacity group-hover:opacity-25"
        style={{ background: tone }}
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-70"
        style={{ background: `linear-gradient(90deg, ${tone}, transparent 75%)` }}
        aria-hidden="true"
      />
      <div className="relative flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-[10.5px] font-medium tracking-[0.05em] text-faint">
          <LiveDot />
          <span className="truncate">{title}</span>
          <span className="rounded-full border border-line/70 bg-panel2/60 px-1.5 py-0.5 text-[8.5px] tracking-[0.12em] text-dim">
            {t("today.liveBadge")}
          </span>
        </span>
        <button
          type="button"
          onClick={onOpen}
          aria-label={`${t("today.liveOpen")}: ${title}`}
          title={`${t("today.liveOpen")}: ${title}`}
          className="shrink-0 rounded-[var(--radius-btn)] border border-line/60 p-1 text-faint transition-colors hover:border-accent/50 hover:text-accent"
        >
          <ArrowUpRight size={13} />
        </button>
      </div>
      {children}
    </section>
  );
}

function statusColor(
  kind: "todo" | "doing" | "done",
  colors: ReturnType<typeof chartTheme>
) {
  return kind === "done" ? colors.ok : kind === "doing" ? colors.accent : colors.dim;
}

/**
 * 首页的实时可视化带：系统采样、任务状态、成本预算、AI 活跃。
 *
 * 四个读数都直接订阅 store，不缓存成图片；history 每轮刷新都会重算折线，
 * 数字用 AnimatedNumber 追赶，悬停折线可读采样点。卡片右上角的箭头才导航，
 * 避免用户只是想看读数时误触。
 */
export function LivePulse() {
  const t = useT();
  const lang = useLang();
  const {
    history,
    tasks,
    costOverview,
    ais,
    sessions,
    procs,
    ports,
    sysinfo,
    theme,
    lastRefreshAt,
    lastDataUpdatedAt,
    loadCostOverview,
    setView,
  } = useStore(
    useShallow((s) => ({
      history: s.history,
      tasks: s.data.tasks,
      costOverview: s.costOverview,
      ais: s.ais,
      sessions: s.sessions,
      procs: s.procs,
      ports: s.ports,
      sysinfo: s.sysinfo,
      theme: s.theme,
      lastRefreshAt: s.lastRefreshAt,
      lastDataUpdatedAt: s.lastDataUpdatedAt,
      loadCostOverview: s.loadCostOverview,
      setView: s.setView,
    }))
  );
  const colors = chartTheme(theme);
  const [showMemory, setShowMemory] = useState(true);

  useEffect(() => {
    void loadCostOverview();
  }, [loadCostOverview]);

  const totalGb = sysinfo ? sysinfo.total_memory / 1024 ** 3 : 0;
  const latest = history.at(-1);
  const latestCpu = latest?.cpu ?? 0;
  const latestMem = latest?.memGb ?? 0;
  const labels = useMemo(
    () =>
      history.map((h) =>
        new Date(h.t).toLocaleTimeString(localeFor(lang), {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      ),
    [history, lang]
  );

  const series = useMemo(() => {
    const cpu = {
      key: "cpu",
      name: t("overview.seriesCpuTotal"),
      color: colors.accent,
      values: history.map((h) => h.cpu),
    };
    const memory = {
      key: "memory",
      name: t("overview.seriesMemory"),
      color: colors.warn,
      values: history.map((h) => (totalGb > 0 ? (h.memGb / totalGb) * 100 : 0)),
    };
    return showMemory ? [cpu, memory] : [cpu];
  }, [history, totalGb, showMemory, t, colors.accent, colors.warn]);

  const taskCounts = useMemo(
    () => ({
      todo: tasks.filter((task) => task.status === "todo").length,
      doing: tasks.filter((task) => task.status === "doing").length,
      done: tasks.filter((task) => task.status === "done").length,
    }),
    [tasks]
  );
  const taskTotal = tasks.length;
  const taskPercent = taskTotal > 0 ? (taskCounts.done / taskTotal) * 100 : 0;
  const budget = costOverview?.daily_budget ?? 0;
  const budgetPct = costOverview?.daily_pct ?? 0;
  const cost = costOverview?.today_cost ?? 0;
  const budgetTone =
    budgetPct >= 100 ? colors.danger : budgetPct >= 70 ? colors.warn : colors.ok;
  const updatedAt = Math.max(lastRefreshAt, lastDataUpdatedAt);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <LiveCard
        title={t("today.liveSystem")}
        tone={colors.accent}
        onOpen={() => setView("overview")}
        className="md:col-span-2 xl:col-span-1"
      >
        <div className="relative mt-2 flex items-end gap-5">
          <div>
            <div className="text-[9.5px] uppercase tracking-[0.12em] text-faint">CPU</div>
            <div className="mt-0.5 leading-none">
              <AnimatedNumber
                value={latestCpu}
                format={(v) => v.toFixed(0)}
                className="text-[29px] font-semibold tracking-[-0.04em]"
              />
              <span className="ml-0.5 text-[13px] text-dim">%</span>
            </div>
          </div>
          <div>
            <div className="text-[9.5px] uppercase tracking-[0.12em] text-faint">
              {t("overview.seriesMemory")}
            </div>
            <div className="mt-0.5 leading-none">
              <AnimatedNumber
                value={latestMem}
                format={(v) => v.toFixed(1)}
                className="text-[22px] font-semibold tracking-[-0.03em] text-dim"
              />
              <span className="ml-0.5 text-[11px] text-faint">GB</span>
            </div>
          </div>
          <div className="ml-auto hidden text-right sm:block">
            <div className="text-[9.5px] text-faint">{t("today.liveUpdated")}</div>
            <div className="num mt-0.5 text-[10.5px] text-dim">
              {updatedAt > 0 ? formatTime(updatedAt) : "—"}
            </div>
          </div>
        </div>

        <div className="mt-1 flex items-center gap-3 text-[10px]">
          <span className="inline-flex items-center gap-1.5 text-dim">
            <CircleDot size={10} style={{ color: colors.accent }} />
            {t("overview.seriesCpuTotal")}
          </span>
          <button
            type="button"
            aria-pressed={showMemory}
            onClick={() => setShowMemory((value) => !value)}
            className={`inline-flex items-center gap-1.5 transition-opacity ${
              showMemory ? "text-dim opacity-100" : "text-faint opacity-55"
            }`}
          >
            <CircleDot size={10} style={{ color: colors.warn }} />
            {t("overview.seriesMemory")}
          </button>
        </div>

        <div className="mt-1">
          <LiveSparkline
            series={series}
            labels={labels}
            height={62}
            emptyLabel={t("today.liveNoData")}
            formatValue={(value) => `${value.toFixed(0)}%`}
          />
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/50 pt-1.5 text-[9.5px] text-faint">
          <span>{t("today.services", { count: procs.length })}</span>
          <span>{t("today.ports", { count: ports.length })}</span>
          <span className="ml-auto text-accent/80">{t("today.liveRealtime")}</span>
        </div>
      </LiveCard>

      <LiveCard
        title={t("today.liveTasks")}
        tone={colors.ok}
        onOpen={() => setView("tasks")}
        className="md:col-span-1"
      >
        <div className="mt-2 flex items-center gap-3">
          <ProgressRing percent={taskPercent} size={62} strokeWidth={5} />
          <div className="min-w-0">
            <div className="text-[9.5px] text-faint">{t("tasks.completionRate")}</div>
            <div className="mt-0.5 text-[20px] font-semibold leading-none">
              <AnimatedNumber value={taskCounts.done} />
              <span className="text-[12px] font-normal text-faint"> / {taskTotal}</span>
            </div>
            <div className="mt-1 text-[10px] text-dim">
              {t("today.liveOpenCount", { count: taskTotal - taskCounts.done })}
            </div>
          </div>
        </div>

        <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-bg">
          {(["todo", "doing", "done"] as const).map((kind) => {
            const count = taskCounts[kind];
            if (count === 0) return null;
            return (
              <div
                key={kind}
                title={`${t(`tasks.col${kind[0].toUpperCase()}${kind.slice(1)}`)} · ${count}`}
                style={{
                  flexGrow: count,
                  backgroundColor: statusColor(kind, colors),
                }}
              />
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-dim">
          {(["todo", "doing", "done"] as const).map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: statusColor(kind, colors) }}
              />
              {t(`tasks.col${kind[0].toUpperCase()}${kind.slice(1)}`)}
              <span className="num text-text">{taskCounts[kind]}</span>
            </span>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-line/50 pt-1.5 text-[9.5px] text-faint">
          <span>{t("today.liveClickHint")}</span>
          <span className="text-ok/85">{t("today.liveRealtime")}</span>
        </div>
      </LiveCard>

      <LiveCard
        title={t("today.liveCost")}
        tone={budgetTone}
        onOpen={() => setView("costs")}
        className="md:col-span-1"
      >
        <div className="mt-2 flex items-end justify-between gap-2">
          <div>
            <div className="text-[9.5px] text-faint">{t("today.today")}</div>
            <div className="mt-0.5 leading-none">
              <AnimatedNumber
                value={cost}
                format={formatUsd}
                className="text-[28px] font-semibold tracking-[-0.04em]"
              />
            </div>
          </div>
          <div className="text-right">
            <div className="text-[9.5px] text-faint">{t("today.liveBudget")}</div>
            <div className="num mt-0.5 text-[12px] text-dim">{formatUsd(budget)}</div>
          </div>
        </div>
        <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-bg">
          <div
            className="h-full rounded-full transition-[width] duration-700"
            style={{
              width: `${Math.min(100, Math.max(0, budgetPct))}%`,
              backgroundColor: budgetTone,
            }}
          />
          <span
            className="absolute top-0 h-full w-px bg-text/40"
            style={{ left: `${Math.min(100, costOverview?.alert_threshold_pct ?? 80)}%` }}
            aria-hidden="true"
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-[9.5px] text-faint">
          <span>{t("today.liveBudgetUsed", { pct: Math.round(budgetPct) })}</span>
          {budgetPct >= 100 && (
            <span className="text-danger">{t("today.liveOverBudget")}</span>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-line/50 pt-1.5 text-[10px]">
          <button
            type="button"
            onClick={() => setView("ai")}
            className="inline-flex items-center gap-1.5 text-dim transition-colors hover:text-accent"
          >
            <LiveDot />
            {t("today.liveAi")}
            <AnimatedNumber value={ais.length} className="text-text" />
          </button>
          <span className="text-faint">
            {t("today.liveSessionCount", { count: sessions.length })}
          </span>
        </div>
      </LiveCard>
    </div>
  );
}
