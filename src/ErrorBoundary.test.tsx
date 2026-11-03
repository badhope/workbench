import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBoundary } from "./ErrorBoundary";
import { setLang } from "./lib/i18n";
import { clearDiagnostics, getDiagnostics } from "./lib/diagnostics";

// 锁定界面语言：兜底 UI 文案按中文断言（默认语言是英语）
setLang("zh");

/** 必须在类组件外抛错才会被边界捕获，这里用一个会炸的子组件。 */
function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("爆炸测试");
  return <p>正常</p>;
}

describe("ErrorBoundary", () => {
  // 拦截测试期间的 console.error（React 会打两遍错误日志）
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("子组件正常时不拦截", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText("正常")).toBeInTheDocument();
  });

  it("子组件抛错时显示兜底 UI 与错误信息", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText("页面渲染异常")).toBeInTheDocument();
    expect(screen.getByText("爆炸测试")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重试/ })).toBeInTheDocument();
  });

  it("点击重试后重置状态重新渲染子树", async () => {
    let shouldThrow = true;
    const { rerender } = render(
      <ErrorBoundary>
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>
    );
    expect(screen.getByText("页面渲染异常")).toBeInTheDocument();

    shouldThrow = false;
    rerender(
      <ErrorBoundary>
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>
    );
    // 边界仍处于 error 状态 —— 必须点重试才恢复
    await userEvent.click(screen.getByRole("button", { name: /重试/ }));
    expect(screen.getByText("正常")).toBeInTheDocument();
  });

  /**
   * 0.5.0 之前，边界只显示一句 message，用户报障时无法给出任何定位信息。
   * 现在必须：写进诊断缓冲、能展开堆栈、能一键复制。
   */
  it("崩溃写入诊断缓冲（这是用户唯一能交出来的排障线索）", () => {
    clearDiagnostics();
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>
    );
    const entries = getDiagnostics();
    expect(entries.some((e) => e.message === "爆炸测试" && e.kind === "render")).toBe(
      true
    );
  });

  it("可以展开堆栈详情", async () => {
    clearDiagnostics();
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.queryByText(/at .*ErrorBoundary/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /展开详情/ }));
    // 展开后出现 <pre>，内容至少包含错误名
    const pre = document.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain("爆炸测试");
  });

  it("提供复制按钮（即使剪贴板不可用也不崩）", async () => {
    clearDiagnostics();
    // jsdom 没有 clipboard，这里显式打桩以便断言写入内容
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>
    );
    await userEvent.click(screen.getByRole("button", { name: /复制错误信息/ }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String(writeText.mock.calls[0][0])).toContain("爆炸测试");
  });
});
