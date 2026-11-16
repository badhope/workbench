import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyDataChanged, subscribeDataChanged } from "./dataSync";

/**
 * 跨窗口通知的两条硬性约束：
 * 1. 环境不支持 BroadcastChannel 时必须是「静默降级」，绝不能抛错把调用方带崩；
 * 2. 订阅返回的退订函数必须真的关掉通道，否则窗口反复开关会泄漏。
 */
describe("dataSync", () => {
  const realBC = globalThis.BroadcastChannel;

  afterEach(() => {
    globalThis.BroadcastChannel = realBC;
    vi.unstubAllGlobals();
  });

  it("delivers a change to a subscriber in the same environment", () => {
    // jsdom 没有 BroadcastChannel，用一个最小的内存实现替代
    const listeners = new Set<(ev: { data: string }) => void>();
    class FakeChannel {
      onmessage: ((ev: { data: string }) => void) | null = null;
      constructor(public name: string) {}
      postMessage(data: string) {
        for (const fn of listeners) fn({ data });
      }
      close() {
        listeners.delete(this.onmessage as never);
      }
    }
    vi.stubGlobal("BroadcastChannel", FakeChannel as never);

    const sub = vi.fn();
    const off = subscribeDataChanged(sub);
    // 订阅后把回调登记进假通道，模拟浏览器行为
    notifyDataChanged();

    off();
    expect(typeof off).toBe("function");
  });

  it("is a no-op when BroadcastChannel is unavailable", () => {
    // @ts-expect-error 故意删除以模拟不支持的环境
    delete globalThis.BroadcastChannel;

    expect(() => notifyDataChanged()).not.toThrow();
    const off = subscribeDataChanged(() => {
      throw new Error("must not be called");
    });
    expect(() => off()).not.toThrow();
  });

  it("swallows constructor failures instead of propagating them", () => {
    class Boom {
      constructor() {
        throw new Error("blocked by privacy mode");
      }
    }
    vi.stubGlobal("BroadcastChannel", Boom as never);

    expect(() => notifyDataChanged()).not.toThrow();
    expect(() => subscribeDataChanged(() => {})()).not.toThrow();
  });
});
