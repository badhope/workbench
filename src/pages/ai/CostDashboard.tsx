import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Coins,
  DollarSign,
  Hash,
  RefreshCw,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { EChart } from "../../lib/echarts";
import { chartGapColor, seriesColors } from "../../lib/chartTheme";
import { useStore } from "../../lib/store";
import { useShallow } from "zustand/react/shallow";
import { useT } from "../../lib/i18n";
import {
  Btn,
  Card,
  ConfirmDialog,
  SectionTitle,
  Skeleton,
  Spinner,
  StatCard,
} from "../../ui";
import { formatTokens, formatUsd } from "../../lib/util";
import type { EChartsCoreOption } from "echarts/core";
import type { CostOverview, ModelBreakdownRow } from "../../types";
import { isPieWorthRendering } from "../../lib/aggregate";
import { costTrendOption, modelBreakdownOption } from "./costCharts";
import { PricingEditor } from "./PricingEditor";
import { usePricingSummary } from "./usePricingSummary";

/**
 * 成本仪表盘：预算告警、四项统计、预算进度条、趋势/模型分解图。
 * 从 AiSessions（原 930 行）拆出，页面只负责组合。
 */
export function CostDashboard() {
  const t = useT();
  const [confirmClear, setConfirmClear] = useState(false);
  const pricing = usePricingSummary();

  const {
    theme,
    costOverview,
    costTrend,
    costModelBreakdown,
    costLoading,
    scanCosts,
    clearCosts,
  } = useStore(
    useShallow((s) => ({
      theme: s.theme,
      costOverview: s.costOverview,
      costTrend: s.costTrend,
      costModelBreakdown: s.costModelBreakdown,
      costLoading: s.costLoading,
      scanCosts: s.scanCosts,
      clearCosts: s.clearCosts,
    }))
  );

  const colors = useMemo(() => seriesColors(theme), [theme]);

  const totalTokensDisplay = useMemo(() => {
    if (!costOverview) return "—";
    return formatTokens(
      costOverview.total_input_tokens + costOverview.total_output_tokens
    );
  }, [costOverview]);

  const budgetStatus = useMemo(() => {
    if (!costOverview) return null;
    return {
      dailyPct: costOverview.daily_pct,
      monthlyPct: costOverview.monthly_pct,
      exceeded: costOverview.budget_exceeded,
      nearLimit:
        costOverview.daily_pct >= costOverview.alert_threshold_pct ||
        costOverview.monthly_pct >= costOverview.alert_threshold_pct,
    };
  }, [costOverview]);

  const costTrendChart = useMemo(
    () =>
      costTrend.length
        ? costTrendOption(costTrend, colors, {
            legend: t("ai.costLegend"),
            tooltip: (value) => t("ai.costTrendTooltip", { value }),
          })
        : null,
    [costTrend, t, colors]
  );

  const modelBreakdownChart = useMemo(
    () =>
      costModelBreakdown.length
        ? modelBreakdownOption(costModelBreakdown, colors, chartGapColor(theme))
        : null,
    [costModelBreakdown, theme, colors]
  );

  // 首次进入且还没有数据：给骨架，而不是四张 $0.00 卡 + 空图表
  if (!costOverview && costLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Card>
          <SectionTitle>{t("ai.costOverviewTitle")}</SectionTitle>
          <Skeleton lines={4} />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <BudgetBanners
        status={budgetStatus}
        threshold={costOverview?.alert_threshold_pct}
      />

      <CostHeader
        overview={costOverview}
        totalTokens={totalTokensDisplay}
        loading={costLoading}
        overrideCount={pricing.count}
        onScan={scanCosts}
        onClear={() => setConfirmClear(true)}
      />

      <BudgetProgress overview={costOverview} />

      <CostCharts
        trend={costTrendChart}
        breakdown={modelBreakdownChart}
        breakdownRows={costModelBreakdown}
        colors={colors}
      />

      <ConfirmDialog
        open={confirmClear}
        title={t("ai.clear")}
        body={t("ai.confirmClearCosts")}
        confirmLabel={t("ai.clear")}
        cancelLabel={t("projects.cancel")}
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          void clearCosts();
        }}
      />

      <PricingEditor
        onChanged={() => {
          // 价格改了，账本里已有记录仍按旧价算出：必须重算，否则界面总额
          // 与用户刚保存的价格对不上。先刷「已覆盖 N 个型号」角标，再扫描；
          // scanCosts 自带防重入，连点不会叠出并发扫描。
          void pricing.refresh();
          void scanCosts();
        }}
      />
    </div>
  );
}

function BudgetBar({
  label,
  pct,
  spent,
  total,
}: {
  label: string;
  pct: number;
  spent: number;
  total: number;
}) {
  const t = useT();
  const clamped = Math.min(pct, 100);
  const exceeded = pct >= 100;
  const nearLimit = pct >= 80 && pct < 100;
  const barColor = exceeded ? "bg-danger" : nearLimit ? "bg-warn" : "bg-accent";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-dim">{t("ai.budgetBarLabel", { label })}</span>
        <span className="font-mono">
          {formatUsd(spent)} / {formatUsd(total)} ({pct.toFixed(0)}%)
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-panel2">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

interface BudgetStatus {
  dailyPct: number;
  monthlyPct: number;
  exceeded: boolean;
  nearLimit: boolean;
}

/** 预算横幅：超限一条、接近阈值一条，二者互斥。 */
function BudgetBanners({
  status,
  threshold,
}: {
  status: BudgetStatus | null;
  threshold?: number;
}) {
  const t = useT();
  if (!status) return null;
  if (status.exceeded) {
    return (
      <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-danger/50 bg-danger/10 px-4 py-3 text-sm">
        <AlertTriangle size={16} className="shrink-0 text-danger" />
        <span className="font-medium text-danger">
          {t("ai.budgetExceeded", {
            daily: status.dailyPct.toFixed(0),
            monthly: status.monthlyPct.toFixed(0),
          })}
        </span>
      </div>
    );
  }
  if (!status.nearLimit) return null;
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-warn/50 bg-warn/10 px-4 py-3 text-sm">
      <AlertTriangle size={16} className="shrink-0 text-warn" />
      <span className="font-medium text-warn">
        {t("ai.budgetNearLimit", {
          daily: status.dailyPct.toFixed(0),
          monthly: status.monthlyPct.toFixed(0),
          threshold: threshold ?? 0,
        })}
      </span>
    </div>
  );
}

/** 四项统计 + 扫描/清空操作。窄屏时按钮换到单独一行。 */
function CostHeader({
  overview,
  totalTokens,
  loading,
  overrideCount,
  onScan,
  onClear,
}: {
  overview: CostOverview | null;
  totalTokens: string;
  loading: boolean;
  overrideCount: number | null;
  onScan: () => void;
  onClear: () => void;
}) {
  const t = useT();
  const stats = costStats(overview, totalTokens, t);

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="grid flex-1 grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>
      <CostActions
        loading={loading}
        overrideCount={overrideCount}
        onScan={onScan}
        onClear={onClear}
      />
    </div>
  );
}

/** 四张统计卡的纯数据描述；组件只负责渲染。 */
function costStats(
  o: CostOverview | null,
  totalTokens: string,
  t: (key: string, vars?: Record<string, string | number>) => string
) {
  const tokens = (input: number, output: number) =>
    t("ai.tokensCount", {
      count: formatTokens(input + output),
    });
  return [
    {
      icon: DollarSign,
      label: t("ai.todayCost"),
      value: money(o?.today_cost),
      tone: "warn" as const,
      hint: o ? tokens(o.today_input_tokens, o.today_output_tokens) : undefined,
    },
    {
      icon: TrendingUp,
      label: t("ai.monthCost"),
      value: money(o?.month_cost),
      tone: "accent" as const,
      hint: o ? tokens(o.month_input_tokens, o.month_output_tokens) : undefined,
    },
    {
      icon: Coins,
      label: t("ai.totalCost"),
      value: money(o?.total_cost),
      tone: "ok" as const,
      hint: o ? t("ai.recordCount", { count: o.record_count }) : undefined,
    },
    {
      icon: Hash,
      label: t("ai.totalTokens"),
      value: totalTokens,
      tone: "text" as const,
      hint: o
        ? t("ai.tokensMeasuredEstimated", {
            measured: o.measured_count,
            estimated: o.estimated_count,
          })
        : undefined,
    },
  ];
}

/** 扫描 / 清空 / 定价覆盖提示。 */
function CostActions({
  loading,
  overrideCount,
  onScan,
  onClear,
}: {
  loading: boolean;
  overrideCount: number | null;
  onScan: () => void;
  onClear: () => void;
}) {
  const t = useT();
  return (
    <div className="flex shrink-0 gap-2 lg:ml-3 lg:flex-col">
      <Btn onClick={onScan} disabled={loading} title={t("ai.scanCostsTitle")}>
        {loading ? <Spinner /> : <RefreshCw size={14} />}
        {loading ? t("ai.scanning") : t("ai.scanCosts")}
      </Btn>
      {/* 全量扫描是长任务：明确告诉用户可能要等几秒，避免误以为界面卡死 */}
      {loading && (
        <span className="max-w-[180px] text-[11px] leading-snug text-dim">
          {t("ai.scanHint")}
        </span>
      )}
      <Btn onClick={onClear} className="!py-1 !text-xs" title={t("ai.clearCostsTitle")}>
        <Trash2 size={12} /> {t("ai.clear")}
      </Btn>
      {/* 定价改过几个型号：改价会直接影响账单，必须在成本页可见 */}
      {!!overrideCount && overrideCount > 0 && (
        <span className="text-[10.5px] text-warn">
          {t("ai.pricingOverrides", { count: overrideCount })}
        </span>
      )}
    </div>
  );
}

/** 缺数据时显示破折号而不是 $0.00（后者会被读成「今天没花钱」）。 */
function money(v: number | undefined): string {
  return v === undefined ? "—" : formatUsd(v);
}

/** 预算进度卡：只有设置了预算才出现。 */
function BudgetProgress({ overview }: { overview: CostOverview | null }) {
  const t = useT();
  if (!overview) return null;
  if (overview.daily_budget <= 0 && overview.monthly_budget <= 0) return null;
  return (
    <Card>
      <SectionTitle>{t("ai.budgetProgress")}</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        {overview.daily_budget > 0 && (
          <BudgetBar
            label={t("ai.today")}
            pct={overview.daily_pct}
            spent={overview.today_cost}
            total={overview.daily_budget}
          />
        )}
        {overview.monthly_budget > 0 && (
          <BudgetBar
            label={t("ai.thisMonth")}
            pct={overview.monthly_pct}
            spent={overview.month_cost}
            total={overview.monthly_budget}
          />
        )}
      </div>
    </Card>
  );
}

/** 趋势 + 模型分解。单分类的饼图不画（一个满圆没有信息量），只列数值。 */
function CostCharts({
  trend,
  breakdown,
  breakdownRows,
  colors,
}: {
  trend: EChartsCoreOption | null;
  breakdown: EChartsCoreOption | null;
  breakdownRows: ModelBreakdownRow[];
  colors: string[];
}) {
  const t = useT();
  if (!trend && !breakdown) return null;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      {trend && (
        <Card className="lg:col-span-3">
          <SectionTitle>{t("ai.costTrendTitle")}</SectionTitle>
          <EChart option={trend} style={{ height: 200 }} lazyUpdate />
        </Card>
      )}
      {breakdown && (
        <Card className="lg:col-span-2">
          <SectionTitle>{t("ai.modelBreakdownTitle")}</SectionTitle>
          {isPieWorthRendering(
            breakdownRows.map((r) => [r.model, r.cost] as [string, number])
          ) && <EChart option={breakdown} style={{ height: 200 }} lazyUpdate />}
          <div className="mt-2 space-y-1">
            {breakdownRows.slice(0, 5).map((r, i) => (
              <div key={r.model} className="flex items-center gap-2 text-xs">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: colors[i % colors.length] }}
                />
                <span className="flex-1 truncate text-dim" title={r.model}>
                  {r.model}
                </span>
                <span className="font-mono text-text">{formatUsd(r.cost)}</span>
                <span className="text-dim">
                  {formatTokens(r.input_tokens + r.output_tokens)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
