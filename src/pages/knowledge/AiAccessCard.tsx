import { useEffect, useState } from "react";
import { Check, Copy, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { Badge, Btn, Card, SectionTitle } from "../../ui";
import { useT } from "../../lib/i18n";
import { useStore } from "../../lib/store";
import { aiActions, aiConfig, aiSetWrites, aiUndo, isBackend } from "../../lib/api";
import type { AiAction } from "../../types";

const COMMAND = "workbench mcp --stdio";

/** AI 接入卡：给外部客户端命令，并提供默认关闭的写入开关与审计撤销。 */
export function AiAccessCard() {
  const t = useT();
  const setToast = useStore((s) => s.setToast);
  const backend = isBackend();
  const [copied, setCopied] = useState(false);
  const [allow, setAllow] = useState(false);
  const [actions, setActions] = useState<AiAction[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!backend) return;
    let alive = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const [cfg, list] = await Promise.all([aiConfig(), aiActions(8)]);
          if (!alive) return;
          setAllow(cfg.allow_writes);
          setActions(list);
        } catch {
          /* 无后端/旧数据时保持关闭状态 */
        } finally {
          if (alive) setLoaded(true);
        }
      })();
    }, 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [backend]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时保留可见命令，用户可手动复制 */
    }
  }

  async function toggle() {
    if (busy || !loaded) return;
    const next = !allow;
    setBusy(true);
    try {
      const cfg = await aiSetWrites(next);
      setAllow(cfg.allow_writes);
      const list = await aiActions(8);
      setActions(list);
      setToast(
        t(cfg.allow_writes ? "knowledge.aiWritesEnabled" : "knowledge.aiWritesDisabled")
      );
    } catch (e) {
      setToast(t("knowledge.aiWriteFailed", { err: String(e) }));
    } finally {
      setBusy(false);
    }
  }

  async function undo(id: string) {
    setBusy(true);
    try {
      await aiUndo(id);
      setActions((prev) => prev.map((a) => (a.id === id ? { ...a, undone: true } : a)));
      setToast(t("knowledge.aiUndoneToast"));
    } catch (e) {
      setToast(t("knowledge.aiUndoFailed", { err: String(e) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <SectionTitle extra={<Sparkles size={14} className="text-accent" />}>
        {t("knowledge.aiTitle")}
      </SectionTitle>
      <p className="mb-2 text-[11px] text-faint">{t("knowledge.aiSub")}</p>
      <div className="flex items-center gap-2 rounded-[5px] border border-line/70 bg-panel2/50 px-2.5 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text">
          {COMMAND}
        </code>
        <Btn onClick={copy} className="!px-2 !py-1 !text-[11px]">
          {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
          {copied ? t("knowledge.copied") : t("knowledge.copy")}
        </Btn>
      </div>

      <div className="mt-3 rounded-[5px] border border-line/70 bg-panel2/40 p-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-xs text-text">
            <ShieldCheck size={13} className={allow ? "text-ok" : "text-faint"} />
            {t("knowledge.aiWrites")}
            <Badge tone={allow ? "ok" : "dim"}>
              {allow ? t("knowledge.aiWritesEnabled") : t("knowledge.aiWritesDisabled")}
            </Badge>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={allow}
            disabled={busy || !loaded || !backend}
            onClick={() => void toggle()}
            className={`relative h-4 w-8 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
              allow ? "bg-accent" : "bg-line"
            }`}
            title={t("knowledge.aiWritesHint")}
          >
            <span
              className={`absolute top-0.5 h-3 w-3 rounded-full bg-[var(--color-bg)] transition-[left] ${
                allow ? "left-[18px]" : "left-0.5"
              }`}
            />
          </button>
        </div>
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">
          {t("knowledge.aiWritesHint")}
        </p>
      </div>

      {actions.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-faint">
            <span>{t("knowledge.aiActions")}</span>
            <span>{actions.length}</span>
          </div>
          <div className="space-y-1">
            {actions.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 rounded-[4px] border border-line/50 bg-panel2/30 px-2 py-1.5 text-[10.5px]"
              >
                <span
                  className={`min-w-0 flex-1 truncate ${a.undone ? "text-faint line-through" : "text-dim"}`}
                >
                  {a.summary}
                </span>
                <code className="shrink-0 font-mono text-[9.5px] text-faint">
                  {a.tool}
                </code>
                {a.undone ? (
                  <Badge tone="dim">{t("knowledge.aiUndone")}</Badge>
                ) : (
                  <Btn
                    variant="ghost"
                    disabled={busy || !allow}
                    onClick={() => void undo(a.id)}
                    className="!px-1.5 !py-0.5 !text-[10px]"
                    title={t("knowledge.aiUndo")}
                  >
                    <RotateCcw size={10} />
                    {t("knowledge.aiUndo")}
                  </Btn>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
        {t("knowledge.aiHint")}
      </p>
    </Card>
  );
}
