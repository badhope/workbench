import { useEffect, useRef } from "react";
import { createParticleField, type ParticleField } from "../lib/particles";
import { effectiveMotion, useStore } from "../lib/store";

/**
 * 氛围粒子背景层。
 *
 * 位置：fixed 全屏、pointer-events-none、z-0——与 global.css 的 body::before
 * 光晕同层（光晕在前，粒子在其上、内容之下），不与任何交互抢事件。
 *
 * 三重省电约束在这里收口：
 * 1. 用户开关（store.particles，默认关）；
 * 2. 生效动效档为 off 时不渲染不启动——「关了动效还跑动画」是自相矛盾；
 * 3. 页面隐藏时 rAF 暂停（createParticleField 内部处理）。
 */
export function ParticleBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  const particles = useStore((s) => s.particles);
  const particlesIntensity = useStore((s) => s.particlesIntensity);
  const motion = useStore((s) => effectiveMotion(s));
  const active = particles && motion !== "off";

  useEffect(() => {
    if (!active) return;
    const canvas = ref.current;
    if (!canvas) return;
    const field: ParticleField = createParticleField(canvas, {
      // 强度由用户滑杆控制（0-100）；内部再封顶 0.55 全局透明度，
      // 拉满也只是「明显」，不会变成屏保。
      intensity: particlesIntensity,
      getColors: () => {
        // 每次取色走 CSS 变量：换主题/自定义主题改色后粒子自动跟随，
        // 不需要在 applyTheme 里增加回调管线。
        const s = getComputedStyle(document.documentElement);
        const pick = (name: string, fallback: string) =>
          s.getPropertyValue(name).trim() || fallback;
        return [
          pick("--color-accent", "#22d3ee"),
          pick("--color-accent2", "#22d3ee"),
          pick("--color-text", "#e8ecf2"),
        ];
      },
    });
    return () => field.destroy();
  }, [active, particlesIntensity]);

  if (!active) return null;
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
    />
  );
}
