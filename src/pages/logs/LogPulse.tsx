import { chartTheme } from "../../lib/chartTheme";
import { useT } from "../../lib/i18n";
import { useStore } from "../../lib/store";
import { DistributionBar, StatStrip } from "../../components/live/StatStrip";

export type LogLevelKey = "error" | "warn" | "info" | "debug";

/**
 * 日志页的读数带：把「错误几条、警告几条」从筛选按钮里抽出来，
 * 用同一套 StatStrip + DistributionBar 呈现；筛选条仍然在下面，点击不改数据。
 */
export function LogPulse({
  counts,
  total,
  shown,
}: {
  counts: Record<LogLevelKey, number>;
  total: number;
  shown: number;
}) {
  const t = useT();
  const theme = useStore((s) => s.theme);
  const colors = chartTheme(theme);

  return (
    <section className="rounded-[var(--radius-card)] border border-line/80 bg-panel/80 px-3.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[10.5px] font-medium tracking-[0.05em] text-faint">
            {t("logs.pulseTitle")}
          </div>
          <div className="mt-0.5 text-[11px] text-dim">{t("logs.pulseSub")}</div>
        </div>
        <span className="rounded-full border border-line/70 bg-panel2/60 px-2 py-0.5 text-[9.5px] text-dim">
          {t("logs.shown", { shown, total })}
        </span>
      </div>
      <div className="mt-2 grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <StatStrip
          items={[
            {
              key: "error",
              label: t("logs.error"),
              value: counts.error,
              tone: "danger",
            },
            {
              key: "warn",
              label: t("logs.warn"),
              value: counts.warn,
              tone: "warn",
            },
            {
              key: "info",
              label: t("logs.info"),
              value: counts.info,
              tone: "accent",
            },
            {
              key: "debug",
              label: t("logs.debug"),
              value: counts.debug,
              tone: "dim",
            },
          ]}
        />
        <div className="min-w-0">
          <div className="mb-1.5 text-[9.5px] text-faint">{t("logs.levelDist")}</div>
          <DistributionBar
            emptyLabel={t("logs.empty")}
            segments={[
              {
                key: "error",
                label: t("logs.error"),
                count: counts.error,
                color: colors.danger,
              },
              {
                key: "warn",
                label: t("logs.warn"),
                count: counts.warn,
                color: colors.warn,
              },
              {
                key: "info",
                label: t("logs.info"),
                count: counts.info,
                color: colors.accent,
              },
              {
                key: "debug",
                label: t("logs.debug"),
                count: counts.debug,
                color: colors.dim,
              },
            ]}
          />
        </div>
      </div>
    </section>
  );
}
