/**
 * 环形进度：工作台首页和回顾页共用。
 * 纯展示组件，颜色全部走主题 token；百分比同时以文本呈现，不依赖颜色传达信息。
 */
export function ProgressRing({
  percent,
  size = 76,
  strokeWidth = 6,
  label,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        viewBox="0 0 100 100"
        className="h-full w-full -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="num font-semibold leading-none"
          style={{ fontSize: Math.round(size * 0.22) }}
        >
          {clamped}%
        </span>
        {label && <span className="mt-1 text-[9px] text-faint">{label}</span>}
      </div>
    </div>
  );
}
