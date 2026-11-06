import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAppRuntime } from "./useAppRuntime";
import { useStore } from "./store";

/**
 * 应用级副作用的生命周期（进阶）。
 *
 * 窗口隐藏时轮询必须停表：否则后台一直采样，笔记本耗电。
 */
const tauriMode = { value: true };
vi.mock("./api", async (orig) => {
  const actual = await orig<typeof import("./api")>();
  return { ...actual, isTauri: () => tauriMode.value, isBackend: () => tauriMode.value };
});

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  tauriMode.value = true;
  setVisibility("visible");
  useStore.setState({ toast: "", refreshMs: 3000 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAppRuntime 轮询", () => {
  it("可见时按间隔刷新，隐藏时停表", async () => {
    const spy = vi.spyOn(useStore.getState(), "refreshRuntime");
    useStore.setState({ refreshRuntime: spy });
    renderHook(() => useAppRuntime());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    const callsWhileVisible = spy.mock.calls.length;
    expect(callsWhileVisible).toBeGreaterThanOrEqual(2);

    setVisibility("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(spy.mock.calls.length).toBe(callsWhileVisible);

    // 恢复可见：立刻补一次，再继续按间隔
    setVisibility("visible");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(spy.mock.calls.length).toBe(callsWhileVisible + 1);
  });

  it("演示模式不建定时器", async () => {
    tauriMode.value = false;
    const spy = vi.fn();
    useStore.setState({ refreshRuntime: spy });
    renderHook(() => useAppRuntime());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
