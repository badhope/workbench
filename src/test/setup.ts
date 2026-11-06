import "@testing-library/jest-dom/vitest";

// jsdom 没有 matchMedia / ResizeObserver / scrollIntoView，
// ECharts 与虚拟滚动相关组件会用到，测试环境统一打桩。
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

class RO implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!window.ResizeObserver) {
  window.ResizeObserver = RO;
}

// ECharts 内部会调用 element.animate，jsdom 缺失时兜底
if (!Element.prototype.animate) {
  Element.prototype.animate = (() =>
    ({
      cancel: () => {},
      finished: Promise.resolve(),
      addEventListener: () => {},
    }) as unknown as Animation) as typeof Element.prototype.animate;
}

/**
 * 单元测试的默认环境是「桌面壳」：绝大多数被测逻辑走 IPC 分支。
 * 需要测浏览器 / 演示行为的用例应在自己的 beforeEach 里显式
 * `delete window.__TAURI_INTERNALS__`，而不是依赖全局默认——
 * 依赖默认会让「这条用例到底在测哪个环境」变得看不出来。
 */
if (!("__TAURI_INTERNALS__" in window)) {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}
