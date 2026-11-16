import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { pollWhileVisible, useAppRuntime } from "./useAppRuntime";
import { useStore } from "./store";

/**
 * 应用级副作用的生命周期。
 *
 * 三段 effect 都做过「挂载时订阅、卸载时解绑」的手工处理，
 * 而漏解绑是最难在界面上发现的缺陷（切换页面越多次，监听器越多）。
 * 这里只验证「能正常挂载与卸载、不抛异常」，因为 jsdom 没有真实的
 * Tauri event 系统；真实 IPC 的解绑由 bundle 里的 tauri API 负责。
 */
describe("useAppRuntime", () => {
  beforeEach(() => {
    useStore.setState({ toast: "" });
  });

  it("挂载与卸载不抛异常", () => {
    expect(() => {
      const { unmount } = renderHook(() => useAppRuntime());
      unmount();
    }).not.toThrow();
  });

  it("ESC 在有 toast 时清空它", () => {
    useStore.setState({ toast: "hello" });
    const { unmount } = renderHook(() => useAppRuntime());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(useStore.getState().toast).toBe("");
    unmount();
  });

  it("没有 toast 时 ESC 不做任何事", () => {
    const { unmount } = renderHook(() => useAppRuntime());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(useStore.getState().toast).toBe("");
    unmount();
  });
});

/**
 * 「窗口隐藏时停止轮询」是省电的实际来源：看不见界面时继续每 3 秒采一次
 * 进程表纯属浪费电。这里直接驱动定时器验证启停，而不是只看渲染结果。
 */
describe("pollWhileVisible", () => {
  function setVisibility(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", {
      value: state,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("可见时按间隔触发，隐藏后停止，再可见时立刻补一次", () => {
    vi.useFakeTimers();
    setVisibility("visible");
    const tick = vi.fn();
    const stop = pollWhileVisible(tick, 3000);

    vi.advanceTimersByTime(9000);
    expect(tick).toHaveBeenCalledTimes(3);

    setVisibility("hidden");
    vi.advanceTimersByTime(9000);
    expect(tick).toHaveBeenCalledTimes(3);

    setVisibility("visible");
    expect(tick).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(3000);
    expect(tick).toHaveBeenCalledTimes(5);

    stop();
    vi.advanceTimersByTime(9000);
    expect(tick).toHaveBeenCalledTimes(5);
  });

  it("卸载后不再触发", () => {
    vi.useFakeTimers();
    setVisibility("visible");
    const tick = vi.fn();
    const stop = pollWhileVisible(tick, 1000);
    stop();
    vi.advanceTimersByTime(5000);
    expect(tick).not.toHaveBeenCalled();
  });
});
