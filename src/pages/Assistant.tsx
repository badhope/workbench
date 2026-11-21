import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Bot,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import { Badge, Btn, Card, Field, Spinner, inputCls } from "../ui";
import { useT } from "../lib/i18n";
import { useStore } from "../lib/store";
import {
  ASSISTANT_DESKTOP_ONLY,
  DEFAULT_ASSISTANT_CONFIG,
  assistantChat,
  assistantConfig,
  assistantSaveConfig,
  assistantStatus,
} from "../lib/assistant";
import type {
  AssistantConfig,
  AssistantStatus,
  AssistantStep,
  AssistantUsage,
  ChatMessage,
} from "../types";

type Turn = ChatMessage & {
  steps?: AssistantStep[];
  usage?: AssistantUsage;
  error?: boolean;
};

/** 助手页：本地 MiniCPM5-2B 的对话入口。
 *
 * 取舍：
 * - 配置就在本页展开，不另开设置页——只调一个模型端点，没必要多一跳。
 * - 工具轨迹默认折叠，需要审计时展开；回答本身保持干净。
 * - 对话只存在内存里：这是本机的一次性问答，不写 localStorage 制造第二份数据。
 */
export default function Assistant() {
  const t = useT();
  const setToast = useStore((s) => s.setToast);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [config, setConfig] = useState<AssistantConfig>(DEFAULT_ASSISTANT_CONFIG);
  const [draft, setDraft] = useState<AssistantConfig>(DEFAULT_ASSISTANT_CONFIG);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [backendMissing, setBackendMissing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const probe = useCallback(async (cfg: AssistantConfig) => {
    setChecking(true);
    try {
      setStatus(await assistantStatus(cfg));
    } catch (e) {
      setStatus({
        ok: false,
        base_url: cfg.base_url,
        model: cfg.model,
        latency_ms: 0,
        models: [],
        error: String(e),
      });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const cfg = await assistantConfig();
        if (!alive) return;
        setConfig(cfg);
        setDraft(cfg);
        await probe(cfg);
      } catch (e) {
        if (!alive) return;
        const message = String(e);
        if (message.includes(ASSISTANT_DESKTOP_ONLY)) setBackendMissing(true);
        else setLoadError(message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [probe]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [turns, busy]);

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000
    );
    return () => clearInterval(timer);
  }, [busy]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy || backendMissing) return;
    setElapsed(0);
    const history: Turn[] = [...turns, { role: "user", content }];
    setTurns(history);
    setInput("");
    setBusy(true);
    try {
      const reply = await assistantChat(
        history.map(({ role, content }) => ({ role, content })),
        config
      );
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: reply.content,
          steps: reply.steps,
          usage: reply.usage,
        },
      ]);
    } catch (e) {
      const message = String(e);
      if (message.includes(ASSISTANT_DESKTOP_ONLY)) {
        setBackendMissing(true);
      } else {
        setTurns((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `${message}\n${t("assistant.retryHint")}`,
            error: true,
          },
        ]);
      }
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setChecking(true);
    try {
      const saved = await assistantSaveConfig(draft);
      setConfig(saved);
      setDraft(saved);
      setStatus(await assistantStatus(saved));
      setToast(t("assistant.saved"));
    } catch (e) {
      setToast(t("assistant.saveFailed", { err: String(e) }));
    } finally {
      setChecking(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  const mismatch =
    status?.ok &&
    status.models.length > 0 &&
    !status.models.some((name) =>
      name.toLowerCase().includes(config.model.toLowerCase())
    );

  const statusTone = checking ? "warn" : status?.ok ? "ok" : "danger";
  const statusLabel = checking
    ? t("assistant.statusChecking")
    : status?.ok
      ? t("assistant.statusOk")
      : t("assistant.statusOff");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line/70 pb-3">
        <Bot size={15} className="text-accent" />
        <span className="section-title">{t("assistant.pageTitle")}</span>
        <span className="text-[11px] text-faint">{t("assistant.pageSub")}</span>
        <span className="ml-auto flex items-center gap-2">
          <Badge tone={statusTone}>
            {statusLabel}
            {status?.ok && !checking && (
              <span className="text-faint">
                {" "}
                · {t("assistant.latency", { ms: status.latency_ms })}
              </span>
            )}
          </Badge>
          <Btn onClick={() => setShowSettings((v) => !v)} title={t("assistant.settings")}>
            <Settings2 size={13} />
          </Btn>
          {turns.length > 0 && (
            <Btn onClick={() => setTurns([])} title={t("assistant.clear")}>
              <Trash2 size={13} />
            </Btn>
          )}
        </span>
      </div>

      {showSettings && (
        <Card className="mt-3 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="section-title">{t("assistant.settings")}</span>
            <span className="flex items-center gap-2">
              {checking && <Spinner />}
              <Btn onClick={() => void probe(draft)} disabled={checking}>
                {t("assistant.check")}
              </Btn>
              <Btn variant="primary" onClick={() => void save()} disabled={checking}>
                {t("assistant.save")}
              </Btn>
            </span>
          </div>
          <div className="grid gap-x-4 gap-y-1 md:grid-cols-2">
            <Field label={t("assistant.endpoint")}>
              <input
                aria-label={t("assistant.endpoint")}
                className={inputCls}
                value={draft.base_url}
                onChange={(e) => setDraft({ ...draft, base_url: e.target.value })}
              />
            </Field>
            <Field label={t("assistant.model")}>
              <input
                aria-label={t("assistant.model")}
                className={inputCls}
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              />
            </Field>
            <Field label={t("assistant.temperature")}>
              <input
                aria-label={t("assistant.temperature")}
                type="number"
                step="0.1"
                min="0"
                max="2"
                className={inputCls}
                value={draft.temperature}
                onChange={(e) =>
                  setDraft({ ...draft, temperature: Number(e.target.value) })
                }
              />
            </Field>
            <Field label={t("assistant.maxTokens")}>
              <input
                aria-label={t("assistant.maxTokens")}
                type="number"
                step="128"
                min="64"
                max="4096"
                className={inputCls}
                value={draft.max_tokens}
                onChange={(e) =>
                  setDraft({ ...draft, max_tokens: Number(e.target.value) })
                }
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={draft.thinking}
              onChange={(e) => setDraft({ ...draft, thinking: e.target.checked })}
            />
            {t("assistant.thinking")}
          </label>
          <div className="space-y-1 text-[11px] text-faint">
            <div>{t("assistant.endpointHint")}</div>
            <div className="font-mono">{t("assistant.startHint")}</div>
            {status?.ok && (
              <div>
                {t("assistant.models", {
                  models: status.models.slice(0, 4).join(", ") || status.model,
                })}
                {mismatch ? ` · ${t("assistant.modelMismatch")}` : ""}
              </div>
            )}
            {status && !status.ok && status.error && (
              <div className="text-danger">{status.error}</div>
            )}
            {loadError && <div className="text-danger">{loadError}</div>}
          </div>
        </Card>
      )}

      <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-card)] border border-line/80 bg-panel">
        <div className="flex-1 space-y-4 overflow-auto p-4">
          {backendMissing ? (
            <Notice
              icon={<Bot size={18} />}
              title={t("assistant.pageTitle")}
              text={t("assistant.desktopOnly")}
            />
          ) : turns.length === 0 ? (
            <EmptyChat
              status={status}
              checking={checking}
              onPick={(text) => void send(text)}
              onSettings={() => setShowSettings(true)}
            />
          ) : (
            turns.map((turn, index) => <Bubble key={index} turn={turn} />)
          )}
          {busy && (
            <div className="flex items-center gap-2 text-[12px] text-dim">
              <Spinner />
              <span>
                {t("assistant.thinking")} · {t("assistant.elapsed", { sec: elapsed })}
              </span>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-line/70 bg-panel2/30 p-3">
          <textarea
            ref={areaRef}
            rows={2}
            className={`${inputCls} resize-none`}
            placeholder={t("assistant.placeholder")}
            aria-label={t("assistant.placeholder")}
            value={input}
            disabled={busy || backendMissing}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[11px] text-faint">{t("assistant.pageSub")}</span>
            <Btn
              variant="primary"
              onClick={() => void send()}
              disabled={busy || backendMissing || !input.trim()}
            >
              <Send size={13} /> {t("assistant.send")}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

function Notice({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-panel2 text-accent">
        {icon}
      </div>
      <div className="text-[13px] font-medium text-text">{title}</div>
      <div className="max-w-md text-[12px] text-dim">{text}</div>
    </div>
  );
}

function EmptyChat({
  status,
  checking,
  onPick,
  onSettings,
}: {
  status: AssistantStatus | null;
  checking: boolean;
  onPick: (text: string) => void;
  onSettings: () => void;
}) {
  const t = useT();
  const suggestions = [
    t("assistant.suggest1"),
    t("assistant.suggest2"),
    t("assistant.suggest3"),
  ];
  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-panel2 text-accent">
        <Sparkles size={18} />
      </div>
      <div>
        <div className="text-[14px] font-medium text-text">
          {t("assistant.emptyTitle")}
        </div>
        <div className="mt-1 max-w-md text-[12px] text-dim">
          {t("assistant.emptyHint")}
        </div>
      </div>
      <div className="flex max-w-xl flex-wrap justify-center gap-2">
        {suggestions.map((text) => (
          <button
            key={text}
            type="button"
            onClick={() => onPick(text)}
            disabled={checking}
            className="rounded-full border border-line bg-panel2/70 px-3 py-1 text-[12px] text-dim transition-colors hover:border-accent/50 hover:text-text"
          >
            {text}
          </button>
        ))}
      </div>
      {status && !status.ok && (
        <button
          type="button"
          onClick={onSettings}
          className="flex max-w-md items-start gap-2 rounded-[var(--radius-btn)] border border-warn/35 bg-warn/8 px-3 py-2 text-left text-[11px] text-warn"
        >
          <Wrench size={13} className="mt-[1px] shrink-0" />
          <span>{status.error || t("assistant.desktopOnly")}</span>
        </button>
      )}
      {status?.ok && status.models.length > 0 && (
        <div className="flex items-center gap-1 text-[11px] text-faint">
          <ShieldCheck size={12} className="text-ok" />
          {status.models.slice(0, 3).join(" · ")}
        </div>
      )}
    </div>
  );
}

function Bubble({ turn }: { turn: Turn }) {
  const t = useT();
  const isUser = turn.role === "user";
  return (
    <div className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-panel2 text-accent">
          <Bot size={12} />
        </div>
      )}
      <div className={`max-w-[86%] ${isUser ? "order-first" : ""}`}>
        <div
          className={`whitespace-pre-wrap rounded-[var(--radius-card)] border px-3 py-2 text-[12.5px] leading-relaxed ${
            isUser
              ? "border-accent/30 bg-accent/10 text-text"
              : turn.error
                ? "border-danger/35 bg-danger/8 text-danger"
                : "border-line bg-panel2/60 text-text"
          }`}
        >
          {turn.content}
        </div>
        {turn.steps && turn.steps.length > 0 && <Steps steps={turn.steps} />}
        {turn.usage &&
          (turn.usage.prompt_tokens > 0 || turn.usage.completion_tokens > 0) && (
            <div className="mt-1 text-right text-[10.5px] text-faint">
              {t("assistant.usage", {
                input: turn.usage.prompt_tokens,
                output: turn.usage.completion_tokens,
              })}
            </div>
          )}
      </div>
      {isUser && (
        <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-panel2 text-[11px] text-dim">
          {t("assistant.you").slice(0, 1)}
        </div>
      )}
    </div>
  );
}

function Steps({ steps }: { steps: AssistantStep[] }) {
  const t = useT();
  const failed = steps.filter((step) => !step.ok).length;
  return (
    <details className="mt-2 rounded-[var(--radius-btn)] border border-line/80 bg-panel2/30 px-2 py-1.5 text-[11px]">
      <summary className="cursor-pointer select-none text-faint">
        {t("assistant.toolCalls", { count: steps.length })}
        {failed > 0 ? ` · ${failed} ${t("assistant.toolFailed")}` : ""}
      </summary>
      <ul className="mt-2 space-y-2">
        {steps.map((step, index) => (
          <li key={index} className="rounded border border-line/60 bg-panel/60 p-2">
            <div className="mb-1 flex items-center gap-2">
              <Badge tone={step.ok ? "ok" : "danger"}>{step.tool}</Badge>
              {step.ok ? null : (
                <span className="text-danger">{t("assistant.toolFailed")}</span>
              )}
            </div>
            <div className="font-mono break-all text-[10.5px] text-faint">
              {step.arguments}
            </div>
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[10.5px] text-dim">
              {step.result}
            </pre>
          </li>
        ))}
      </ul>
    </details>
  );
}
