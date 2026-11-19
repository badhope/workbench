import { useEffect, useRef, useState } from "react";
import { effectiveMotion, useStore } from "../../lib/store";

/**
 * 数字的“追赶”动画：数值变化时从旧值滚到新值，不是直接换一个静态文本。
 * 初始渲染直接显示真值，避免首屏等一段动画；动效关闭时也直接跳变。
 */
export function AnimatedNumber({
  value,
  format = (v) => String(Math.round(v)),
  className = "",
}: {
  value: number;
  format?: (value: number) => string;
  className?: string;
}) {
  const motion = useStore((s) => effectiveMotion(s));
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (motion === "off" || from === value) {
      setDisplay(value);
      return;
    }
    let frame = 0;
    const started = performance.now();
    const duration = 520;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else setDisplay(value);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, motion]);

  return (
    <span className={`num tabular-nums ${className}`} aria-label={format(value)}>
      {format(display)}
    </span>
  );
}
