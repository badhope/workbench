import { useId, useMemo, useState } from "react";
import { useT } from "../../lib/i18n";

export interface LiveSeries {
  key: string;
  name: string;
  color: string;
  values: number[];
}

/**
 * 双序列实时折线：鼠标移动读到最近采样点，显示十字线与数值气泡。
 * 图形直接消费 history，不缓存成图片；每次采样变化都会重算路径。
 */
export function LiveSparkline({
  series,
  labels,
  height = 66,
  emptyLabel,
  formatValue = (v) => v.toFixed(0),
}: {
  series: LiveSeries[];
  labels: string[];
  height?: number;
  emptyLabel?: string;
  formatValue?: (value: number) => string;
}) {
  const t = useT();
  const gradientId = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const count = Math.max(...series.map((s) => s.values.length), 0);
  const allValues = useMemo(
    () => series.flatMap((s) => s.values.filter((v) => Number.isFinite(v))),
    [series]
  );
  // 不固定 0-100：当前曲线只用实际量程，低负载时也能看出形状和拐点。
  const maxY = Math.max(1, ...allValues) * 1.08;
  const primary = series[0];

  const pathFor = (values: number[]) =>
    values
      .map((value, index) => {
        const x = count <= 1 ? 50 : (index / (count - 1)) * 100;
        const y = 36 - (Math.max(0, Math.min(maxY, value)) / maxY) * 32;
        return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");

  const areaPath =
    primary && primary.values.length > 0
      ? `${pathFor(primary.values)} L 100 40 L 0 40 Z`
      : "";

  const activeIndex = hover ?? Math.max(0, count - 1);
  const activeX =
    count <= 1 ? 50 : (Math.max(0, activeIndex) / Math.max(1, count - 1)) * 100;
  const hoverLabel = labels[activeIndex] ?? "";
  const tooltipShift = activeX < 18 ? "0%" : activeX > 82 ? "-100%" : "-50%";

  if (count === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-[var(--radius-btn)] border border-dashed border-line/70 text-[11px] text-faint"
        style={{ height }}
      >
        {emptyLabel ?? t("today.liveNoData")}
      </div>
    );
  }

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{ height }}
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        setHover(Math.round(ratio * Math.max(0, count - 1)));
      }}
      onMouseLeave={() => setHover(null)}
    >
      <svg
        className="h-full w-full"
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${primary?.name ?? ""} ${formatValue(primary?.values.at(-1) ?? 0)}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={primary?.color} stopOpacity="0.26" />
            <stop offset="100%" stopColor={primary?.color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[10, 20, 30].map((y) => (
          <line
            key={y}
            x1="0"
            x2="100"
            y1={y}
            y2={y}
            stroke="var(--color-line)"
            strokeOpacity="0.55"
            strokeDasharray="1 4"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}
        {series.map((item) => (
          <path
            key={item.key}
            d={pathFor(item.values)}
            fill="none"
            stroke={item.color}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            opacity={item.key === primary?.key ? 1 : 0.72}
          />
        ))}
        {hover !== null && (
          <>
            <line
              x1={activeX}
              x2={activeX}
              y1="4"
              y2="36"
              stroke="var(--color-text)"
              strokeOpacity="0.35"
              vectorEffect="non-scaling-stroke"
            />
            {series.map((item) => {
              const value = item.values[activeIndex] ?? 0;
              const y = 36 - (Math.max(0, Math.min(maxY, value)) / maxY) * 32;
              return (
                <circle
                  key={item.key}
                  cx={activeX}
                  cy={y}
                  r="1.6"
                  fill={item.color}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </>
        )}
        {primary && primary.values.length > 0 && (
          <circle
            cx={count <= 1 ? 50 : 100}
            cy={
              36 - (Math.max(0, Math.min(maxY, primary.values.at(-1) ?? 0)) / maxY) * 32
            }
            r="2.2"
            fill={primary.color}
            className="animate-pulse"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <span
        className="live-scan pointer-events-none absolute inset-y-0 w-16 bg-gradient-to-r from-transparent via-accent/10 to-transparent"
        aria-hidden="true"
      />
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-1 z-20 min-w-[88px] rounded-[var(--radius-btn)] border border-line/80 bg-panel/95 px-2 py-1.5 text-[10px] shadow-lg backdrop-blur-sm"
          style={{ left: `${activeX}%`, transform: `translateX(${tooltipShift})` }}
        >
          <div className="mb-0.5 text-faint">{hoverLabel}</div>
          {series.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-dim">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                {item.name}
              </span>
              <span className="num text-text">
                {formatValue(item.values[activeIndex] ?? 0)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
