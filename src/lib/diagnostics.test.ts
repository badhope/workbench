import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDiagnostics,
  diagnosticsReport,
  getDiagnostics,
  installGlobalDiagnostics,
  recordDiagnostic,
  setViewResolver,
  subscribeDiagnostics,
} from "./diagnostics";

/**
 * 这些测试守的是「出问题时用户能不能把信息交出来」。
 *
 * 之所以值得单独测：诊断缓冲坏了不会让任何功能失败，只会让下一次报障
 * 变成"它坏了 + 一张截图"，排查成本翻倍。所以每条能力都要有断言。
 */
describe("诊断缓冲", () => {
  beforeEach(() => {
    clearDiagnostics();
    setViewResolver(undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("记录错误并分配可读 id", () => {
    const e = recordDiagnostic("error", "boom");
    expect(e).not.toBeNull();
    expect(e!.id).toMatch(/^E\d{3}$/);
    expect(getDiagnostics()[0].message).toBe("boom");
  });

  it("空消息不记录（避免满屏 undefined）", () => {
    recordDiagnostic("error", "   ");
    expect(getDiagnostics()).toHaveLength(0);
  });

  it("连续相同错误只留一条", () => {
    // 每 3 秒刷新的图表报错时，50 条容量会被同一句话瞬间占满
    for (let i = 0; i < 20; i++) recordDiagnostic("error", "same");
    expect(getDiagnostics()).toHaveLength(1);
  });

  it("不同错误分别保留，最新的在最前", () => {
    recordDiagnostic("error", "first");
    recordDiagnostic("rejection", "second");
    const list = getDiagnostics();
    expect(list).toHaveLength(2);
    expect(list[0].message).toBe("second");
  });

  it("容量上限 50 条，超出丢弃最旧的", () => {
    for (let i = 0; i < 60; i++) recordDiagnostic("error", `err-${i}`);
    expect(getDiagnostics()).toHaveLength(50);
    expect(getDiagnostics()[0].message).toBe("err-59");
  });

  it("带上当前页面，便于定位是哪个页面炸的", () => {
    setViewResolver(() => "costs");
    const e = recordDiagnostic("error", "chart failed");
    expect(e!.view).toBe("costs");
  });

  it("订阅者收到通知，订阅可取消", () => {
    const fn = vi.fn();
    const off = subscribeDiagnostics(fn);
    recordDiagnostic("error", "a");
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    recordDiagnostic("error", "b");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("报告是可直接粘贴的纯文本", () => {
    recordDiagnostic("error", "boom", "Error: boom\n  at foo.ts:1");
    const report = diagnosticsReport();
    expect(report).toContain("boom");
    expect(report).toContain("at foo.ts:1");
  });

  it("没有记录时报告说明为空，而不是空字符串", () => {
    expect(diagnosticsReport()).toContain("无前端错误记录");
  });

  describe("全局钩子", () => {
    it("捕获 window error 事件", () => {
      const off = installGlobalDiagnostics();
      window.dispatchEvent(
        new ErrorEvent("error", {
          message: "uncaught!",
          error: new Error("uncaught!"),
        })
      );
      const list = getDiagnostics();
      expect(list.some((e) => e.message === "uncaught!" && e.kind === "error")).toBe(
        true
      );
      off();
    });

    it("捕获未处理的 Promise 拒绝（字符串原因也要记录）", () => {
      const off = installGlobalDiagnostics();
      const evt = new Event("unhandledrejection") as Event & { reason?: unknown };
      // jsdom 没有 PromiseRejectionEvent，用自定义事件模拟
      Object.defineProperty(evt, "reason", { value: "plain string reason" });
      window.dispatchEvent(evt);
      const list = getDiagnostics();
      expect(list.some((e) => e.message.includes("plain string reason"))).toBe(true);
      off();
    });

    it("卸载后不再记录", () => {
      const off = installGlobalDiagnostics();
      off();
      window.dispatchEvent(new ErrorEvent("error", { message: "after off" }));
      expect(getDiagnostics()).toHaveLength(0);
    });
  });
});
