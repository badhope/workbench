/**
 * 氛围粒子背景（Canvas 2D，零依赖）。
 *
 * 为什么用 Canvas 2D 而不是 WebGL：粒子数量在几十的量级，2D 完全够用，
 * 省掉了 WebGL 上下文的显存与兼容性成本。定位是「氛围」而不是「特效秀」：
 * 粒子缓慢上浮、轻微摆动，颜色取自当前主题的强调色——它必须安静到
 * 不会和监控数据抢注意力，这是它能留在这个产品里的前提。
 *
 * 省电三重保护（缺一不可，都在调用方/本模块里强制）：
 * 1. 页面隐藏（切窗口/最小化）自动暂停 rAF；
 * 2. 动效档位为 off 时不启动（联动 data-motion，见 ParticleBackdrop）；
 * 3. 用户开关默认关闭。
 */

/** 单个粒子的状态。坐标是 CSS 像素（非物理像素）。 */
export interface Particle {
  x: number;
  y: number;
  /** 上浮速度（px/s，负值向上） */
  vy: number;
  /** 水平摆动幅度（px）与相位 */
  sway: number;
  phase: number;
  /** 半径 px 与透明度 0-1 */
  r: number;
  alpha: number;
  /** 颜色索引：0=accent 1=accent2 2=text */
  tone: number;
}

/**
 * 按画布面积估算粒子数：约每 22000px² 一颗，钳制在 24–72。
 * 小窗口不显得空，大窗口不会变成星海（那是屏保，不是工作台）。
 */
export function computeParticleCount(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0;
  const raw = Math.round((width * height) / 22_000);
  return Math.min(72, Math.max(24, raw));
}

/**
 * 推进一个粒子的位置（纯函数，便于单测）。
 * dt 为秒。上浮 + 正弦水平摆动；浮出顶部后从底部重生，横向环绕。
 */
export function advanceParticle(
  p: Particle,
  dt: number,
  width: number,
  height: number,
  time: number
): Particle {
  const y = p.y + p.vy * dt;
  const wrappedY = y < -4 ? height + 4 : y;
  const x = p.x + Math.sin(time * 0.0006 + p.phase) * p.sway * dt;
  const wrappedX = ((x % width) + width) % width;
  return { ...p, x: wrappedX, y: wrappedY };
}

export interface ParticleFieldOptions {
  /** 氛围强度 0-100（来自主题 glow 或独立滑杆），映射到全局透明度 */
  intensity: number;
  /** 取主题色：返回 [accent, accent2, text] 三色 */
  getColors: () => [string, string, string];
}

export interface ParticleField {
  destroy: () => void;
}

/**
 * 启动粒子场。返回 destroy()；调用方在关闭/卸载时必须调用。
 * rAF/visibility 全部可注入以便测试（默认用全局实现）。
 */
export function createParticleField(
  canvas: HTMLCanvasElement,
  opts: ParticleFieldOptions,
  env: {
    raf: (cb: (t: number) => void) => number;
    cancel: (id: number) => void;
    visibility: () => boolean;
    onVisibilityChange: (cb: () => void) => () => void;
  } = {
    raf: (cb) => requestAnimationFrame(cb),
    cancel: (id) => cancelAnimationFrame(id),
    visibility: () => !document.hidden,
    onVisibilityChange: (cb) => {
      document.addEventListener("visibilitychange", cb);
      return () => document.removeEventListener("visibilitychange", cb);
    },
  }
): ParticleField {
  const ctx = canvas.getContext("2d");
  if (!ctx) return { destroy: () => {} };

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
  };
  resize();

  const spawn = (): Particle => ({
    x: Math.random() * canvas.clientWidth,
    y: Math.random() * canvas.clientHeight,
    vy: -(6 + Math.random() * 14),
    sway: 4 + Math.random() * 10,
    phase: Math.random() * Math.PI * 2,
    r: 0.8 + Math.random() * 1.7,
    alpha: 0.25 + Math.random() * 0.45,
    tone: Math.random() < 0.6 ? 0 : Math.random() < 0.75 ? 1 : 2,
  });

  const particles: Particle[] = Array.from(
    { length: computeParticleCount(canvas.clientWidth, canvas.clientHeight) },
    spawn
  );

  // 全局透明度：强度 0-100 → 0-0.55。即使拉满也不喧宾夺主。
  const globalAlpha = (Math.min(Math.max(opts.intensity, 0), 100) / 100) * 0.55;

  // 取色每秒刷新一次（而不是每帧）：getComputedStyle 有成本，
  // 而换主题的瞬间晚几百毫秒换色完全不可感知。
  let colors = opts.getColors();
  let lastColorAt = 0;
  let rafId = 0;
  let running = false;
  let last = 0;

  const frame = (t: number) => {
    const dt = Math.min((t - last) / 1000, 0.05);
    last = t;
    if (t - lastColorAt > 1000) {
      lastColorAt = t;
      colors = opts.getColors();
    }
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = globalAlpha;
    for (let i = 0; i < particles.length; i++) {
      particles[i] = advanceParticle(particles[i], dt, w, h, t);
      const p = particles[i];
      ctx.fillStyle = colors[p.tone];
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (running) rafId = env.raf(frame);
  };

  const start = () => {
    if (running || !env.visibility()) return;
    running = true;
    last = performance.now();
    rafId = env.raf(frame);
  };
  const stop = () => {
    running = false;
    env.cancel(rafId);
  };

  const offVisibility = env.onVisibilityChange(() => {
    if (env.visibility()) start();
    else stop();
  });

  const observer =
    typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
  observer?.observe(canvas);

  start();
  return {
    destroy: () => {
      stop();
      offVisibility();
      observer?.disconnect();
    },
  };
}
