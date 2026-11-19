import { AnimatedNumber } from "./AnimatedNumber";

export type StatTone = "accent" | "ok" | "warn" | "danger" | "dim";

const TONE_TEXT: Record<StatTone, string> = {
  accent: "text-accent",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  dim: "text-dim",
};

const TONE_BAR: Record<StatTone, string> = {
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  dim: "bg-dim",
};

export interface StatItem {
  key: string;
  label: string;
  value: number;
  suffix?: string;
  hint?: string;
  tone?: StatTone;
}

/**
 * 通用的四格读数条：数字变化时会追赶，左侧色条用语义色而不是背景色块，
 * 三个页面共用同一套密度，不再各自手写一排大数字。
 */
export function StatStrip({
  items,
  className = "",
}: {
  items: StatItem[];
  className?: string;
}) {
  return (
    <div className={`grid grid-cols-2 gap-2 xl:grid-cols-4 ${className}`}>
      {items.map((item) => {
        const tone = item.tone ?? "accent";
        return (
          <div
            key={item.key}
            className="relative overflow-hidden rounded-[var(--radius-btn)] border border-line/70 bg-panel2/35 px-2.5 py-2"
          >
            <span
              className={`absolute inset-y-0 left-0 w-0.5 ${TONE_BAR[tone]}`}
              aria-hidden="true"
            />
            <div className="truncate text-[9.5px] tracking-[0.04em] text-faint">
              {item.label}
            </div>
            <div className="mt-0.5 flex items-baseline gap-0.5 leading-none">
              <AnimatedNumber
                value={item.value}
                className={`text-[21px] font-semibold tracking-[-0.04em] ${TONE_TEXT[tone]}`}
              />
              {item.suffix && <span className="text-[10px] text-dim">{item.suffix}</span>}
            </div>
            {item.hint && (
              <div className="mt-1 truncate text-[9.5px] text-faint">{item.hint}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export interface DistributionSegment {
  key: string;
  label: string;
  count: number;
  color: string;
}

/**
 * 一条可交互图例的横向分布条：宽度按真实计数分配，鼠标悬停有 title，
 * 下方图例同时显示数字。没有数据时退化成虚线占位，不画一根假条。
 */
export function DistributionBar({
  segments,
  emptyLabel = "—",
}: {
  segments: DistributionSegment[];
  emptyLabel?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  if (total === 0) {
    return (
      <div className="flex h-8 items-center rounded-[var(--radius-btn)] border border-dashed border-line/70 px-2 text-[10px] text-faint">
        {emptyLabel}
      </div>
    );
  }
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-bg">
        {segments.map((segment) =>
          segment.count === 0 ? null : (
            <div
              key={segment.key}
              title={`${segment.label} · ${segment.count}`}
              style={{ flexGrow: segment.count, backgroundColor: segment.color }}
            />
          )
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-dim">
        {segments.map((segment) => (
          <span key={segment.key} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: segment.color }}
            />
            {segment.label}
            <span className="num text-text">{segment.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
