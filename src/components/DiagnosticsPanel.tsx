import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AlertTriangle, CheckCircle2, CircleHelp, RefreshCw } from "lucide-react";
import { runDiagnostics } from "../lib/api";
import { useT } from "../lib/i18n";
import { Badge, Btn, Card, SectionTitle, Spinner } from "../ui";
import {
  clearDiagnostics,
  diagnosticsReport,
  getDiagnostics,
  subscribeDiagnostics,
} from "../lib/diagnostics";
import type { DiagnosticCheck, DiagnosticsReport } from "../types";

const LEVEL_TONE = {
  ok: "ok",
  warn: "warn",
  fail: "danger",
} as const;

/**
 * 环境自检面板。
 *
 * 为什么放在设置页而不是单独一页：用户只在「东西不工作」时才需要它，
 * 而那时他们已经在翻设置了。面板自身不诊断任何逻辑——所有判断在后端
 * `diagnostics.rs`，前端只负责让每一项可读、可复制、可重跑。
 */
export function DiagnosticsPanel() {
  const t = useT();
  const frontendErrors = useSyncExternalStore(
    subscribeDiagnostics,
    getDiagnostics,
    getDiagnostics
  );
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setReport(await runDiagnostics());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // 首次挂载自动跑一次。setState 发生在 await 之后，不在同步渲染路径上；
  // 规则把「effect 内立即调用会 setState 的异步函数」也标成了级联渲染风险。
  useEffect(() => {
    const id = setTimeout(() => void run(), 0);
    return () => clearTimeout(id);
  }, [run]);

  const copy = () => {
    if (!report) return;
    const lines = [
      `Workbench ${report.app_version} · ${report.platform}`,
      `data: ${report.data_dir}`,
      ...report.checks.map(
        (c) => `[${c.level}] ${c.id}: ${c.detail}${c.hint ? ` — ${c.hint}` : ""}`
      ),
      "",
      "— 前端错误记录 —",
      diagnosticsReport(),
    ];
    void navigator.clipboard?.writeText(lines.join("\n"));
  };

  return (
    <Card>
      <SectionTitle
        extra={
          <span className="flex items-center gap-2">
            {report && (
              <span className="flex items-center gap-1.5 text-[11px] text-dim">
                <Badge tone="ok">{report.ok_count}</Badge>
                <Badge tone="warn">{report.warn_count}</Badge>
                <Badge tone="danger">{report.fail_count}</Badge>
              </span>
            )}
            <Btn className="!py-1 !text-xs" onClick={() => void run()} disabled={loading}>
              {loading ? <Spinner /> : <RefreshCw size={12} />} {t("diag.run")}
            </Btn>
            {report && (
              <Btn className="!py-1 !text-xs" onClick={copy}>
                {t("diag.copy")}
              </Btn>
            )}
          </span>
        }
      >
        {t("diag.title")}
      </SectionTitle>

      <p className="mb-3 text-[11px] leading-relaxed text-dim">{t("diag.sub")}</p>

      {error && (
        <div className="flex items-start gap-2 rounded-[var(--radius-btn)] border border-danger/40 bg-danger/8 px-3 py-2 text-xs text-danger">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!report && loading && <Spinner />}

      {report && (
        <ul className="flex flex-col gap-1.5">
          {report.checks.map((c) => (
            <CheckRow key={c.id} check={c} />
          ))}
        </ul>
      )}

      <FrontendErrors entries={frontendErrors} />
    </Card>
  );
}

/**
 * 前端错误记录。
 *
 * 后端自检只能证明「环境与磁盘没问题」；页面白屏、按钮点了没反应这类
 * 问题全在渲染进程，如果没有这一块，用户看到的诊断报告是"全部通过"，
 * 而实际功能是坏的 —— 那比没有诊断更误导。
 */
function FrontendErrors({ entries }: { entries: ReturnType<typeof getDiagnostics> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (entries.length === 0) {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-faint">
        <CheckCircle2 size={12} className="text-ok" />
        {t("diag.noFrontendErrors")}
      </p>
    );
  }
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-[11.5px] font-medium text-warn"
        >
          <AlertTriangle size={12} />
          {t("diag.frontendErrors", { count: entries.length })}
        </button>
        <Btn className="!py-0.5 !text-[10px]" onClick={() => clearDiagnostics()}>
          {t("diag.clearFrontendErrors")}
        </Btn>
      </div>
      {open && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {entries.map((e) => (
            <li
              key={e.id}
              className="rounded-[var(--radius-btn)] border border-line/60 bg-panel2/40 px-2.5 py-2"
            >
              <div className="flex items-center gap-2 text-[10.5px] text-faint">
                <code>{e.id}</code>
                <span>{new Date(e.at).toLocaleString()}</span>
                <Badge tone="warn">{e.kind}</Badge>
                {e.view && <span>@{e.view}</span>}
              </div>
              <div className="mt-0.5 break-words text-[11.5px] text-text">
                {e.message}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CheckRow({ check }: { check: DiagnosticCheck }) {
  const tone = LEVEL_TONE[check.level as keyof typeof LEVEL_TONE] ?? "warn";
  const Icon =
    check.level === "ok"
      ? CheckCircle2
      : check.level === "fail"
        ? AlertTriangle
        : CircleHelp;
  return (
    <li className="flex items-start gap-2 rounded-[var(--radius-btn)] border border-line/60 bg-panel2/40 px-2.5 py-2">
      <Icon
        size={13}
        className={`mt-0.5 shrink-0 ${tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-danger"}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[12px] font-medium text-text">
            {check.label}
          </span>
          <code className="shrink-0 text-[9.5px] text-faint">{check.id}</code>
        </div>
        <div className="truncate text-[11px] text-dim" title={check.detail}>
          {check.detail}
        </div>
        {check.hint && (
          <div className="mt-0.5 text-[10.5px] text-faint">{check.hint}</div>
        )}
      </div>
    </li>
  );
}
