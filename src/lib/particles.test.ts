import { afterEach, describe, expect, it, vi } from "vitest";
import {
  advanceParticle,
  computeParticleCount,
  createParticleField,
  type Particle,
} from "./particles";

const p = (over: Partial<Particle> = {}): Particle => ({
  x: 100,
  y: 500,
  vy: -20,
  sway: 10,
  phase: 0,
  r: 1.5,
  alpha: 0.5,
  tone: 0,
  ...over,
});

describe("computeParticleCount", () => {
  it("按面积估算并钳制在 24-72", () => {
    expect(computeParticleCount(1440, 900)).toBe(59);
    expect(computeParticleCount(800, 600)).toBe(24); // 21.8 → 下限
    expect(computeParticleCount(4000, 2000)).toBe(72); // 363 → 上限
  });

  it("非法尺寸给 0（画布还没布局完时不撒粒子）", () => {
    expect(computeParticleCount(0, 900)).toBe(0);
    expect(computeParticleCount(1440, 0)).toBe(0);
  });
});

describe("advanceParticle", () => {
  it("上浮：vy 为负，y 随时间减小", () => {
    const next = advanceParticle(p({ y: 500, vy: -20 }), 1, 1440, 900, 0);
    expect(next.y).toBe(480);
  });

  it("浮出顶部后从底部重生（y < -4 → height+4）", () => {
    const next = advanceParticle(p({ y: -5, vy: -20 }), 0.1, 1440, 900, 0);
    expect(next.y).toBe(904);
  });

  it("横向环绕：sin 摆动把 x 推出左边界后从右侧回来", () => {
    // time 使 sin(0.0006*t) = -1 → x 位移 = -sway*dt，用大 dt 逼出环绕
    const next = advanceParticle(p({ x: 2, sway: 1000 }), 0.01, 1440, 900, 2618);
    expect(next.x).toBeGreaterThanOrEqual(0);
    expect(next.x).toBeLessThan(1440);
  });
});

describe("createParticleField", () => {
  /** 构造一个 jsdom 可用的假 canvas（getContext 返回可调用的 2D 存根）。 */
  const fakeCanvas = () => {
    const calls = { clear: 0, fill: 0 };
    const canvas = {
      clientWidth: 1440,
      clientHeight: 900,
      width: 0,
      height: 0,
      getContext: () => ({
        clearRect: () => void calls.clear++,
        beginPath: () => {},
        arc: () => {},
        fill: () => void calls.fill++,
        set globalAlpha(_v: number) {},
        set fillStyle(_v: string) {},
      }),
    };
    return { canvas: canvas as unknown as HTMLCanvasElement, calls };
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("页面可见时启动 rAF，帧内绘制全部粒子", () => {
    const { canvas, calls } = fakeCanvas();
    let rafCb: ((t: number) => void) | null = null;
    const raf = vi.fn((cb: (t: number) => void) => {
      rafCb = cb;
      return 1;
    });
    const field = createParticleField(
      canvas,
      { intensity: 65, getColors: () => ["#fff", "#fff", "#fff"] },
      {
        raf: raf as unknown as (cb: (t: number) => void) => number,
        cancel: vi.fn(),
        visibility: () => true,
        onVisibilityChange: () => () => {},
      }
    );
    expect(raf).toHaveBeenCalled();
    // 手动跑两帧：dt 由时间戳决定
    (rafCb as unknown as (t: number) => void)(0);
    (rafCb as unknown as (t: number) => void)(16);
    expect(calls.fill).toBeGreaterThan(0);
    field.destroy();
  });

  it("页面隐藏时不启动；destroy 后取消 rAF 且不再绘制", () => {
    const { canvas, calls } = fakeCanvas();
    const cancel = vi.fn();
    const raf = vi.fn(() => 1);
    const field = createParticleField(
      canvas,
      { intensity: 50, getColors: () => ["#fff", "#fff", "#fff"] },
      {
        raf: raf as unknown as (cb: (t: number) => void) => number,
        cancel,
        visibility: () => false,
        onVisibilityChange: () => () => {},
      }
    );
    expect(raf).not.toHaveBeenCalled();
    field.destroy();
    expect(cancel).toHaveBeenCalled();
    expect(calls.fill).toBe(0);
  });

  it("jsdom 无 2D 上下文时安静降级（返回 noop destroy）", () => {
    const canvas = {
      clientWidth: 100,
      clientHeight: 100,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    const field = createParticleField(
      canvas,
      { intensity: 50, getColors: () => ["#fff", "#fff", "#fff"] },
      {
        raf: vi.fn(() => 1),
        cancel: vi.fn(),
        visibility: () => true,
        onVisibilityChange: () => () => {},
      }
    );
    expect(() => field.destroy()).not.toThrow();
  });

  it("窗口尺寸变化时按新面积重设画布并继续绘制", () => {
    const { canvas, calls } = fakeCanvas();
    let roCb: (() => void) | null = null;
    class RO {
      constructor(cb: () => void) {
        roCb = cb;
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", RO);
    const rafCbs: Array<(t: number) => void> = [];
    const raf = vi.fn((cb: (t: number) => void) => {
      rafCbs.push(cb);
      return rafCbs.length;
    });
    const field = createParticleField(
      canvas,
      { intensity: 65, getColors: () => ["#fff", "#fff", "#fff"] },
      {
        raf: raf as unknown as (cb: (t: number) => void) => number,
        cancel: vi.fn(),
        visibility: () => true,
        onVisibilityChange: () => () => {},
      }
    );
    // 模拟容器尺寸变化 → resize 用新 clientWidth/Height 重设画布
    (canvas as unknown as { clientWidth: number }).clientWidth = 800;
    roCb!();
    (rafCbs[rafCbs.length - 1] as (t: number) => void)(16);
    expect(canvas.width).toBe(800 * (window.devicePixelRatio || 1));
    expect(calls.fill).toBeGreaterThan(0);
    field.destroy();
    vi.unstubAllGlobals();
  });

  it("visibility 回调：隐藏时暂停，恢复时重新调度", () => {
    const { canvas } = fakeCanvas();
    let visible = true;
    let visCb: (() => void) | null = null;
    const rafCbs: Array<(t: number) => void> = [];
    const raf = vi.fn((cb: (t: number) => void) => {
      rafCbs.push(cb);
      return rafCbs.length;
    });
    const cancel = vi.fn();
    const field = createParticleField(
      canvas,
      { intensity: 50, getColors: () => ["#fff", "#fff", "#fff"] },
      {
        raf: raf as unknown as (cb: (t: number) => void) => number,
        cancel,
        visibility: () => visible,
        onVisibilityChange: (cb) => {
          visCb = cb;
          return () => {};
        },
      }
    );
    const scheduledAtStart = raf.mock.calls.length;
    // 隐藏 → stop（rAF 被取消）
    visible = false;
    visCb!();
    expect(cancel).toHaveBeenCalled();
    // 恢复 → start 重新调度
    visible = true;
    visCb!();
    expect(raf.mock.calls.length).toBeGreaterThan(scheduledAtStart);
    field.destroy();
  });
});
