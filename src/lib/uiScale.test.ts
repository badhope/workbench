import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyUiScale, resetAppliedScaleForTests } from "./uiScale";

/**
 * 界面缩放。
 *
 * 关注两点：值必须被夹在 0.85–1.2（再小读不清、再大会把右侧栏挤爆），
 * 以及同一个值重复应用时不重复触碰 DOM（缩放会触发全页重排）。
 */
beforeEach(() => {
  // 这个文件默认测浏览器行为（CSS zoom），个别用例自己注入桌面标记。
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

afterEach(() => {
  resetAppliedScaleForTests();
  document.documentElement.style.zoom = "";
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe("applyUiScale", () => {
  it("浏览器里用 CSS zoom 应用缩放", () => {
    applyUiScale(1.1);
    expect(document.documentElement.style.zoom).toBe("1.1");
  });

  it("超过 1.2 被夹到上限", () => {
    applyUiScale(3);
    expect(document.documentElement.style.zoom).toBe("1.2");
  });

  it("低于 0.85 被夹到下限", () => {
    applyUiScale(0.1);
    expect(document.documentElement.style.zoom).toBe("0.85");
  });

  it("非法值回落到 100%（默认值，因此不写 DOM）", () => {
    applyUiScale(1.2);
    applyUiScale(Number.NaN);
    // 回落到 1 与初始状态一致：不留下 1.2 的残影
    expect(document.documentElement.style.zoom).toBe("1");
  });

  it("同一个值重复应用不重复写 DOM", () => {
    applyUiScale(1.05);
    const spy = vi.spyOn(document.documentElement.style, "zoom", "set");
    applyUiScale(1.05);
    expect(spy).not.toHaveBeenCalled();
  });

  it("桌面端不写 CSS zoom（交给 WebView 的 setZoom）", () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    applyUiScale(1.15);
    expect(document.documentElement.style.zoom).toBe("");
  });
});
