import { Component, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, Copy, RefreshCw } from "lucide-react";
import { t } from "./lib/i18n";
import { recordDiagnostic } from "./lib/diagnostics";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  /** 展开后显示堆栈与组件栈；默认收起，不吓到普通用户 */
  showDetail: boolean;
  copied: boolean;
}

/**
 * 错误边界：捕获子组件渲染异常，显示友好提示并提供恢复按钮。
 *
 * 与 0.4.0 的差别：那时只显示 `error.message` 一句话，用户报障只能说
 * "它坏了"，维护者拿不到任何定位信息。现在同时记录到诊断缓冲，
 * 并在「详情」里给出堆栈、组件栈和一个短 id，可直接复制粘贴进 issue。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, showDetail: false, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 记进缓冲区：这样即使这一步之后用户直接关掉窗口，下次打开诊断页
    // 仍然能看到这条（localStorage 持久化）。
    recordDiagnostic(
      "render",
      error.message || String(error),
      [error.stack, info.componentStack].filter(Boolean).join("\n\n组件栈:\n")
    );
    // 同时留在控制台，方便开发时直接看
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = () => this.setState({ error: null, showDetail: false, copied: false });

  copy = async () => {
    const { error } = this.state;
    if (!error) return;
    try {
      await navigator.clipboard.writeText(
        `${error.message}\n\n${error.stack ?? ""}\n\nUA: ${navigator.userAgent}`
      );
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      this.setState({ copied: false });
    }
  };

  render() {
    if (this.state.error) {
      const { error, showDetail, copied } = this.state;
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 bg-bg p-10 text-center">
          <AlertTriangle size={40} className="text-danger" />
          <h2 className="text-lg font-semibold">{t("err.title")}</h2>
          <p className="max-w-md break-words text-sm text-dim">{error.message}</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={this.reset}
              className="flex items-center gap-2 rounded-[var(--radius-btn)] bg-accentsoft px-4 py-2 text-sm text-accent hover:bg-accent/20"
            >
              <RefreshCw size={14} />
              {t("err.retry")}
            </button>
            <button
              onClick={() => this.setState({ showDetail: !showDetail })}
              className="flex items-center gap-2 rounded-[var(--radius-btn)] px-4 py-2 text-sm text-dim hover:text-text"
            >
              <ChevronDown
                size={14}
                className={
                  showDetail ? "rotate-180 transition-transform" : "transition-transform"
                }
              />
              {t("err.details")}
            </button>
            <button
              onClick={this.copy}
              className="flex items-center gap-2 rounded-[var(--radius-btn)] px-4 py-2 text-sm text-dim hover:text-text"
            >
              <Copy size={14} />
              {copied ? t("err.copied") : t("err.copy")}
            </button>
          </div>
          {showDetail && (
            <pre className="mt-2 max-h-64 w-full max-w-2xl overflow-auto rounded-[var(--radius-card)] border border-line bg-panel2 p-3 text-left font-mono text-[11px] leading-relaxed text-text/80">
              {error.stack ?? error.message}
            </pre>
          )}
          <p className="text-[11px] text-faint">{t("err.hint")}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
