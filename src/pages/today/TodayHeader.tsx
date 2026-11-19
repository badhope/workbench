import type dayjs from "dayjs";
import { formatTime } from "../../lib/util";
import { localeFor, useLang, useT } from "../../lib/i18n";
import { BrandMark } from "../../components/BrandMark";
import { ProgressRing } from "../../components/ProgressRing";

function HeroOrbit() {
  return (
    <svg
      className="pointer-events-none absolute -right-16 -top-20 h-[300px] w-[300px] text-accent/30 sm:-right-4 sm:-top-16"
      viewBox="0 0 200 200"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="100" cy="100" r="94" stroke="currentColor" strokeOpacity=".22" />
      <circle
        cx="100"
        cy="100"
        r="72"
        stroke="currentColor"
        strokeOpacity=".12"
        strokeDasharray="1.5 8"
      />
      <g className="hero-orbit-spin">
        <circle cx="100" cy="6" r="4" fill="currentColor" fillOpacity=".7" />
        <circle cx="194" cy="100" r="2.5" fill="currentColor" fillOpacity=".45" />
        <circle cx="100" cy="172" r="2" fill="currentColor" fillOpacity=".3" />
      </g>
    </svg>
  );
}

export function TodayHeader({
  now,
  lang,
  modeNames,
  onChangeMode,
  done,
  total,
  dataUpdatedAt,
}: {
  now: dayjs.Dayjs;
  lang: ReturnType<typeof useLang>;
  modeNames: { labelKey: string }[];
  onChangeMode: () => void;
  done: number;
  total: number;
  dataUpdatedAt: number;
}) {
  const t = useT();
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <header className="workbench-hero relative rounded-[calc(var(--radius-card)+4px)] border border-line/80 px-5 py-6 sm:px-7 sm:py-7">
      <HeroOrbit />
      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-4 sm:gap-5">
          <BrandMark
            className="mt-1 h-12 w-[54px] shrink-0 text-accent sm:h-16 sm:w-[72px]"
            strokeWidth={4.5}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-faint">
              <span className="num">
                {now.toDate().toLocaleDateString(localeFor(lang), {
                  month: "long",
                  day: "numeric",
                  weekday: "long",
                })}
              </span>
              {modeNames.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={onChangeMode}
                    className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10.5px] text-dim transition-colors hover:border-accent/40 hover:text-text"
                    title={t("workMode.change")}
                  >
                    {modeNames.map((m) => t(m.labelKey)).join(" / ")}
                  </button>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span title={t("app.dataUpdatedAt", { time: formatTime(dataUpdatedAt) })}>
                {dataUpdatedAt > 0
                  ? t("app.dataUpdatedAt", { time: formatTime(dataUpdatedAt) })
                  : t("app.dataWaiting")}
              </span>
            </div>
            <h1 className="t-heading mt-2 text-[34px] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-[44px]">
              {t("today.title")}
            </h1>
            <p className="mt-2 max-w-[34ch] text-[13px] leading-relaxed text-dim">
              {t("today.subtitle")}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 self-start rounded-[calc(var(--radius-card))] border border-line/60 bg-panel/70 px-3 py-2.5 backdrop-blur-sm sm:self-center sm:gap-4 sm:px-4">
          <ProgressRing percent={percent} size={76} strokeWidth={6} />
          <div className="min-w-0">
            <div className="text-[10px] text-faint">{t("today.today")}</div>
            <div className="mt-0.5 whitespace-nowrap text-[12px] font-medium">
              {t("today.progress", { done, total })}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
