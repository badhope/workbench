import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBreakpoint } from "./useBreakpoint";

/**
 * 断点 hook。
 *
 * 之前这段没有任何测试，而它决定「侧栏是抽屉还是常驻」——
 * 一旦判断失效，窄屏下导航就不可达。
 */
// 监听器要跨多次 setWidth 存活：hook 在挂载时注册，之后宽度变化时
// 由同一批监听器收到通知。每次调用新建数组的话，通知会打给空列表。
const listeners: (() => void)[] = [];

function setWidth(px: number) {
  // jsdom 没有真实布局，只能打桩 matchMedia
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    let matched = true;
    if (max) matched = matched && px <= Number(max[1]);
    if (min) matched = matched && px >= Number(min[1]);
    return {
      matches: matched,
      media: query,
      onchange: null,
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  }) as never;
  return () => listeners.forEach((fn) => fn());
}

describe("useBreakpoint", () => {
  it("390px 判为 compact（侧栏变抽屉）", () => {
    setWidth(390);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("compact");
  });

  it("900px 判为 medium", () => {
    setWidth(900);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("medium");
  });

  it("1440px 判为 wide", () => {
    setWidth(1440);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("wide");
  });

  it("断点变化时 hook 跟着更新", () => {
    const notify = setWidth(1440);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("wide");

    act(() => {
      setWidth(500);
      notify();
    });
    expect(result.current).toBe("compact");
  });
});

describe("useIsCompact", () => {
  it("只在 compact 断点返回 true", async () => {
    const { useIsCompact } = await import("./useBreakpoint");
    setWidth(390);
    expect(renderHook(() => useIsCompact()).result.current).toBe(true);
    setWidth(1440);
    expect(renderHook(() => useIsCompact()).result.current).toBe(false);
  });
});
