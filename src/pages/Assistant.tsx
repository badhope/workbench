import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  BookOpen,
  Bot,
  Calculator,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  Cpu,
  Gauge,
  Layers3,
  ListChecks,
  Network,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Square,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  Wallet,
  Wrench,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge, Btn, Card, Field, Spinner, inputCls } from "../ui";
import { useT } from "../lib/i18n";
import { formatUsd } from "../lib/util";
import { isDesktop } from "../lib/transport";
import { useStore } from "../lib/store";
import {
  ASSISTANT_DESKTOP_ONLY,
  DEFAULT_ASSISTANT_CONFIG,
  assistantCancel,
  assistantChatStream,
  assistantConfig,
  assistantSaveConfig,
  assistantStartService,
  assistantStatus,
  assistantStopService,
} from "../lib/assistant";
import type {
  AssistantConfig,
  AssistantEvent,
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

/** 助手页：本机模型或 OpenAI 兼容网关的对话入口。
 *
 * 视觉取舍：
 * - 大字号、强层次：提问区是主视觉，状态与模型信息做成轻量指标卡。
 * - 工具轨迹默认折叠；展开后按工具分卡、参数与原始返回分层，避免整段 JSON 糊在脸上。
 * - 回答用 Markdown 渲染，模型偶尔输出的 ** 强调不会露成原始符号。
 * - 对话只存在内存里：这是本机的一次性问答，不写 localStorage 制造第二份数据。
 */
export default function Assistant() {
  const t = useT();
  const setToast = useStore((s) => s.setToast);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const requestIdRef = useRef("");
  const stopRequestedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [config, setConfig] = useState<AssistantConfig>(DEFAULT_ASSISTANT_CONFIG);
  const [draft, setDraft] = useState<AssistantConfig>(DEFAULT_ASSISTANT_CONFIG);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelOpen, setModelOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [backendMissing, setBackendMissing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const probe = useCallback(
    async (cfg: AssistantConfig) => {
      setChecking(true);
      try {
        const next = await assistantStatus(cfg);
        setStatus(next);
        setModels(next.models);
        if (next.ok && next.models.length > 0) {
          setToast(t("assistant.modelsFound", { count: next.models.length }));
        }
      } catch (e) {
        setStatus({
          ok: false,
          base_url: cfg.base_url,
          model: cfg.model,
          latency_ms: 0,
          models: [],
          error: String(e),
        });
        setModels([]);
      } finally {
        setChecking(false);
      }
    },
    [setToast, t]
  );

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

  function patchLast(patch: (turn: Turn) => Partial<Turn>) {
    setTurns((prev) =>
      prev.map((turn, index) =>
        index === prev.length - 1 ? { ...turn, ...patch(turn) } : turn
      )
    );
  }

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy || backendMissing) return;
    setElapsed(0);
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    requestIdRef.current = requestId;
    stopRequestedRef.current = false;
    const history: Turn[] = [...turns, { role: "user", content }];
    // 先放一个空的助手气泡，随后所有增量都 patch 它；用户能立刻看到
    // “已发出 + 正在生成”，而不是等完整回复回来才整段跳出。
    setTurns([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    const abort = new AbortController();
    abortRef.current = abort;
    let streamFailed = false;
    try {
      await assistantChatStream(
        history.map(({ role, content }) => ({ role, content })),
        config,
        requestId,
        (event: AssistantEvent) => {
          if (stopRequestedRef.current || requestIdRef.current !== requestId) return;
          if (event.kind === "delta") {
            patchLast((turn) => ({ content: turn.content + event.text }));
          } else if (event.kind === "step" && event.step) {
            const step = event.step;
            patchLast((turn) => ({
              steps: [...(turn.steps ?? []), step],
            }));
          } else if (event.kind === "done" && event.reply) {
            const reply = event.reply;
            patchLast(() => ({
              content: reply.content,
              steps: reply.steps,
              usage: reply.usage,
            }));
          } else if (event.kind === "stopped") {
            patchLast((turn) => ({
              content: turn.content || t("assistant.stopped"),
            }));
          } else if (event.kind === "error") {
            streamFailed = true;
            patchLast(() => ({
              content: `${event.text}\n${t("assistant.retryHint")}`,
              error: true,
            }));
          }
        },
        abort.signal
      );
    } catch (e) {
      if (!stopRequestedRef.current && !streamFailed) {
        const message = String(e);
        if (message.includes(ASSISTANT_DESKTOP_ONLY)) {
          setBackendMissing(true);
        } else {
          patchLast(() => ({
            content: `${message}\n${t("assistant.retryHint")}`,
            error: true,
          }));
        }
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setBusy(false);
        requestIdRef.current = "";
        abortRef.current = null;
      }
    }
  }

  function stop() {
    stopRequestedRef.current = true;
    const requestId = requestIdRef.current;
    abortRef.current?.abort();
    if (requestId) void assistantCancel(requestId);
    setBusy(false);
    patchLast((turn) => ({
      content: turn.content || t("assistant.stopped"),
    }));
  }

  async function serviceStart() {
    setChecking(true);
    try {
      const saved = await assistantSaveConfig(draft);
      setConfig(saved);
      setDraft(saved);
      const next = await assistantStartService(saved);
      setStatus(next);
      if (next.ok) setToast(t("assistant.serviceStarted"));
      else setToast(next.error || t("assistant.serviceFailed"));
    } catch (e) {
      setToast(t("assistant.serviceFailed", { err: String(e) }));
    } finally {
      setChecking(false);
    }
  }

  async function serviceStop() {
    setChecking(true);
    try {
      const stopped = await assistantStopService();
      setStatus(await assistantStatus(config));
      setToast(t(stopped ? "assistant.serviceStopped" : "assistant.serviceNotRunning"));
    } catch (e) {
      setToast(t("assistant.serviceFailed", { err: String(e) }));
    } finally {
      setChecking(false);
    }
  }

  async function save() {
    setChecking(true);
    try {
      const saved = await assistantSaveConfig(draft);
      setConfig(saved);
      setDraft(saved);
      const next = await assistantStatus(saved);
      setStatus(next);
      setModels(next.models);
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
      <div className="flex flex-wrap items-center gap-3 border-b border-line/70 pb-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10 text-accent shadow-[0_8px_24px_-12px_var(--color-accent)]">
          <Bot size={20} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[19px] font-semibold tracking-tight text-text">
              {t("assistant.pageTitle")}
            </span>
            <span className="rounded-full border border-line bg-panel2/80 px-2 py-0.5 text-[11px] font-medium text-faint">
              AI WORKSPACE
            </span>
          </div>
          <div className="mt-1 text-[13px] text-dim">{t("assistant.pageSub")}</div>
        </div>
        <span className="ml-auto flex items-center gap-2">
          <Badge tone={statusTone} className="px-2.5 py-1 text-[12px]">
            {statusLabel}
            {status?.ok && !checking && (
              <span className="text-faint">
                {" "}
                · {t("assistant.latency", { ms: status.latency_ms })}
              </span>
            )}
          </Badge>
          <Btn
            className="h-9 w-9 justify-center px-0"
            onClick={() => setShowSettings((v) => !v)}
            title={t("assistant.settings")}
          >
            <Settings2 size={16} />
          </Btn>
          {turns.length > 0 && (
            <Btn
              className="h-9 w-9 justify-center px-0"
              onClick={() => setTurns([])}
              title={t("assistant.clear")}
            >
              <Trash2 size={16} />
            </Btn>
          )}
        </span>
      </div>

      {showSettings && (
        <Card className="mt-4 rounded-2xl p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[16px] font-semibold text-text">
                {t("assistant.settings")}
              </div>
              <div className="mt-0.5 text-[12px] text-faint">
                {t("assistant.endpointHint")}
              </div>
            </div>
            <span className="flex items-center gap-2">
              {checking && <Spinner />}
              <Btn
                className="h-9 px-4 text-[13px]"
                onClick={() => void probe(draft)}
                disabled={checking}
              >
                {t("assistant.check")}
              </Btn>
              <Btn
                variant="primary"
                className="h-9 px-4 text-[13px]"
                onClick={() => void save()}
                disabled={checking}
              >
                {t("assistant.save")}
              </Btn>
            </span>
          </div>
          <div className="grid gap-x-5 gap-y-1 md:grid-cols-2 [&_button]:text-[13.5px] [&_input]:min-h-[42px] [&_input]:py-2 [&_input]:text-[13.5px] [&_label>span]:text-[12.5px]">
            <Field label={t("assistant.endpoint")}>
              <input
                aria-label={t("assistant.endpoint")}
                className={inputCls}
                value={draft.base_url}
                onChange={(e) => {
                  setModels([]);
                  setModelOpen(false);
                  setDraft({ ...draft, base_url: e.target.value });
                }}
              />
            </Field>
            <Field label={t("assistant.apiKey")}>
              <input
                aria-label={t("assistant.apiKey")}
                type="password"
                autoComplete="off"
                spellCheck={false}
                className={inputCls}
                placeholder="sk-…"
                value={draft.api_key ?? ""}
                onChange={(e) => {
                  setModels([]);
                  setModelOpen(false);
                  setDraft({ ...draft, api_key: e.target.value });
                }}
              />
            </Field>
            <Field label={t("assistant.model")}>
              <div className="flex items-stretch gap-1.5">
                {models.length > 0 ? (
                  <div className="relative min-w-0 flex-1">
                    <button
                      type="button"
                      aria-label={t("assistant.model")}
                      aria-haspopup="listbox"
                      aria-expanded={modelOpen}
                      className={`${inputCls} flex items-center justify-between gap-2 text-left`}
                      onClick={() => setModelOpen((open) => !open)}
                    >
                      <span className="truncate">{draft.model}</span>
                      <ChevronDown size={13} className="shrink-0 text-faint" />
                    </button>
                    {modelOpen && (
                      <div
                        role="listbox"
                        aria-label={t("assistant.modelList")}
                        className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-[var(--radius-btn)] border border-line bg-panel py-1 shadow-xl"
                      >
                        {models.map((name) => (
                          <button
                            key={name}
                            type="button"
                            role="option"
                            aria-selected={name === draft.model}
                            className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] hover:bg-panel2 ${
                              name === draft.model ? "text-accent" : "text-text"
                            }`}
                            onClick={() => {
                              setDraft({ ...draft, model: name });
                              setModelOpen(false);
                            }}
                          >
                            <span className="truncate">{name}</span>
                            {name === draft.model && <Check size={12} />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <input
                    aria-label={t("assistant.model")}
                    className={`${inputCls} min-w-0 flex-1`}
                    value={draft.model}
                    onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                  />
                )}
                <Btn
                  title={t("assistant.fetchModels")}
                  onClick={() => {
                    setModelOpen(false);
                    void probe(draft);
                  }}
                  disabled={checking}
                >
                  <RefreshCw size={13} />
                </Btn>
              </div>
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
            <Field label={t("assistant.serverBin")}>
              <input
                aria-label={t("assistant.serverBin")}
                className={inputCls}
                placeholder="/path/to/llama-server"
                value={draft.server_bin}
                onChange={(e) => setDraft({ ...draft, server_bin: e.target.value })}
              />
            </Field>
            <Field label={t("assistant.modelPath")}>
              <input
                aria-label={t("assistant.modelPath")}
                className={inputCls}
                placeholder="/path/to/MiniCPM5-2B-Q4_K_M.gguf"
                value={draft.model_path}
                onChange={(e) => setDraft({ ...draft, model_path: e.target.value })}
              />
            </Field>
            <Field label={t("assistant.contextSize")}>
              <input
                aria-label={t("assistant.contextSize")}
                type="number"
                step="1024"
                min="512"
                max="32768"
                className={inputCls}
                value={draft.context_size}
                onChange={(e) =>
                  setDraft({ ...draft, context_size: Number(e.target.value) })
                }
              />
            </Field>
          </div>
          {isDesktop() && (
            <div className="flex flex-wrap items-center gap-2">
              <Btn onClick={() => void serviceStart()} disabled={checking}>
                {t("assistant.startService")}
              </Btn>
              <Btn onClick={() => void serviceStop()} disabled={checking}>
                {t("assistant.stopService")}
              </Btn>
            </div>
          )}
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

      <div className="relative mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-line/80 bg-panel shadow-[0_24px_80px_-48px_rgba(15,23,42,0.55)]">
        {turns.length > 0 && (
          <div className="flex items-center justify-between gap-3 border-b border-line/60 bg-panel2/25 px-5 py-3">
            <span className="flex items-center gap-2 text-[13px] font-medium text-text">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
              </span>
              {t("assistant.liveThread")}
            </span>
            <span className="text-[11.5px] text-faint">
              {t("assistant.turnCount", { count: turns.length })}
            </span>
          </div>
        )}
        <div className="flex-1 space-y-6 overflow-auto px-4 py-5 md:px-7">
          {backendMissing ? (
            <Notice
              icon={<Bot size={20} />}
              title={t("assistant.pageTitle")}
              text={t("assistant.desktopOnly")}
            />
          ) : turns.length === 0 ? (
            <EmptyChat
              status={status}
              checking={checking}
              model={config.model}
              onPick={(text) => void send(text)}
              onSettings={() => setShowSettings(true)}
            />
          ) : (
            turns.map((turn, index) => <Bubble key={index} turn={turn} />)
          )}
          {busy && (
            <div className="flex items-center gap-3 rounded-2xl border border-accent/20 bg-accent/5 px-4 py-3 text-[13px] text-dim">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/10 text-accent">
                <Sparkles size={16} className="animate-pulse" />
              </span>
              <span>{t("assistant.thinking")}</span>
              <span className="ml-auto num text-[12px] text-faint">
                {t("assistant.elapsed", { sec: elapsed })}
              </span>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-line/70 bg-panel2/30 p-3.5 md:p-4">
          <div className="rounded-2xl border border-line bg-panel px-1.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors focus-within:border-accent/60 focus-within:bg-panel">
            <textarea
              ref={areaRef}
              rows={2}
              className="min-h-[66px] w-full resize-none bg-transparent px-3 py-2.5 text-[15px] leading-relaxed text-text outline-none placeholder:text-faint"
              placeholder={t("assistant.placeholder")}
              aria-label={t("assistant.placeholder")}
              value={input}
              disabled={busy || backendMissing}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <div className="flex items-center justify-between gap-3 px-1.5 pb-0.5">
              <span className="hidden items-center gap-1.5 text-[11.5px] text-faint sm:flex">
                <kbd className="rounded-md border border-line bg-panel2 px-1.5 py-0.5 font-mono text-[10.5px]">
                  Enter
                </kbd>
                {t("assistant.enterHint")}
              </span>
              {busy ? (
                <Btn variant="danger" className="h-10 px-5 text-[13.5px]" onClick={stop}>
                  <Square size={14} /> {t("assistant.stop")}
                </Btn>
              ) : (
                <Btn
                  variant="primary"
                  className="h-10 px-5 text-[13.5px]"
                  onClick={() => void send()}
                  disabled={backendMissing || !input.trim()}
                >
                  <Send size={15} /> {t("assistant.send")}
                </Btn>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Notice({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-panel2 text-accent">
        {icon}
      </div>
      <div className="text-[16px] font-semibold text-text">{title}</div>
      <div className="max-w-md text-[13.5px] leading-relaxed text-dim">{text}</div>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "accent";
}) {
  const toneCls =
    tone === "ok"
      ? "border-ok/25 bg-ok/8 text-ok"
      : tone === "accent"
        ? "border-accent/25 bg-accent/8 text-accent"
        : "border-line bg-panel2/60 text-dim";
  return (
    <div className="rounded-2xl border border-line/80 bg-panel/70 p-3.5">
      <div className="flex items-center gap-2">
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-xl border ${toneCls}`}
        >
          {icon}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-faint">
          {label}
        </span>
      </div>
      <div className="mt-2 truncate text-[15px] font-semibold text-text">{value}</div>
    </div>
  );
}

function EmptyChat({
  status,
  checking,
  model,
  onPick,
  onSettings,
}: {
  status: AssistantStatus | null;
  checking: boolean;
  model: string;
  onPick: (text: string) => void;
  onSettings: () => void;
}) {
  const t = useT();
  const suggestions = [
    {
      text: t("assistant.suggest1"),
      hint: t("assistant.suggest1Hint"),
      icon: <CalendarDays size={18} />,
      cls: "from-sky-500/12 to-cyan-400/5 text-sky-500",
    },
    {
      text: t("assistant.suggest2"),
      hint: t("assistant.suggest2Hint"),
      icon: <Network size={18} />,
      cls: "from-violet-500/12 to-fuchsia-400/5 text-violet-500",
    },
    {
      text: t("assistant.suggest3"),
      hint: t("assistant.suggest3Hint"),
      icon: <Wallet size={18} />,
      cls: "from-amber-500/12 to-orange-400/5 text-amber-500",
    },
    {
      text: t("assistant.suggest4"),
      hint: t("assistant.suggest4Hint"),
      icon: <BookOpen size={18} />,
      cls: "from-emerald-500/12 to-teal-400/5 text-emerald-500",
    },
  ];
  return (
    <div className="relative overflow-hidden rounded-[22px] border border-line/80 bg-panel p-5 md:p-7">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(70% 90% at 92% 0%, color-mix(in srgb, var(--color-accent) 16%, transparent), transparent 60%), radial-gradient(50% 70% at 0% 100%, color-mix(in srgb, var(--color-accent) 8%, transparent), transparent 65%)",
        }}
      />
      <div className="relative">
        <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/8 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-accent">
          <Sparkles size={12} />
          Workbench AI
        </div>
        <h2 className="mt-4 max-w-2xl text-[28px] font-semibold leading-[1.18] tracking-tight text-text md:text-[32px]">
          {t("assistant.emptyTitle")}
        </h2>
        <p className="mt-2.5 max-w-2xl text-[14.5px] leading-relaxed text-dim">
          {t("assistant.emptyHint")}
        </p>

        <div className="mt-6 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Metric
            icon={status?.ok ? <CircleCheck size={14} /> : <CircleAlert size={14} />}
            label={t("assistant.metricStatus")}
            value={
              checking
                ? t("assistant.metricChecking")
                : status?.ok
                  ? t("assistant.metricOnline")
                  : t("assistant.metricOffline")
            }
            tone={status?.ok ? "ok" : "neutral"}
          />
          <Metric
            icon={<Cpu size={14} />}
            label={t("assistant.metricModel")}
            value={model || "—"}
            tone="accent"
          />
          <Metric
            icon={<Layers3 size={14} />}
            label={t("assistant.metricTools")}
            value={t("assistant.metricToolsValue")}
          />
          <Metric
            icon={<Clock3 size={14} />}
            label={t("assistant.metricLatency")}
            value={status?.ok ? `${status.latency_ms} ms` : "—"}
          />
        </div>

        <div className="mt-5 grid gap-2.5 md:grid-cols-2">
          {suggestions.map((item, index) => (
            <button
              key={item.text}
              type="button"
              aria-label={item.text}
              onClick={() => onPick(item.text)}
              disabled={checking}
              className="group flex min-h-[104px] items-start gap-3.5 rounded-2xl border border-line/80 bg-panel/75 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-accent/35 hover:shadow-[0_16px_36px_-24px_rgba(15,23,42,0.5)] disabled:opacity-50"
            >
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line/60 bg-gradient-to-br ${item.cls}`}
              >
                {item.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-semibold leading-snug text-text">
                  {item.text}
                </span>
                <span className="mt-1 block text-[12px] leading-relaxed text-faint">
                  {item.hint}
                </span>
              </span>
              <ChevronRight
                size={16}
                className="mt-1 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
              />
              <span className="sr-only">{index + 1}</span>
            </button>
          ))}
        </div>

        {status && !status.ok && (
          <button
            type="button"
            onClick={onSettings}
            className="mt-4 flex max-w-lg items-start gap-2.5 rounded-xl border border-warn/35 bg-warn/8 px-3.5 py-3 text-left text-[12.5px] leading-relaxed text-warn"
          >
            <Wrench size={15} className="mt-0.5 shrink-0" />
            <span>{status.error || t("assistant.desktopOnly")}</span>
          </button>
        )}
        {status?.ok && status.models.length > 0 && (
          <div className="mt-4 flex items-center gap-1.5 text-[11.5px] text-faint">
            <ShieldCheck size={13} className="text-ok" />
            {status.models.slice(0, 4).join(" · ")}
          </div>
        )}
      </div>
    </div>
  );
}

function MessageMarkdown({ content }: { content: string }) {
  return (
    <div className="assistant-md text-[15px] leading-[1.8] text-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-2 mt-4 text-[20px] font-semibold first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-3 text-[17px] font-semibold first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1.5 mt-2.5 text-[15.5px] font-semibold first:mt-0">
              {children}
            </h3>
          ),
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          strong: ({ children }) => (
            <strong className="rounded bg-accent/8 px-0.5 font-semibold text-text">
              {children}
            </strong>
          ),
          ul: ({ children }) => (
            <ul className="my-2 list-disc space-y-1 pl-5 marker:text-accent">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-accent">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-[1.7]">{children}</li>,
          code: ({ children }) => (
            <code className="rounded-md border border-line/60 bg-panel2 px-1.5 py-0.5 font-mono text-[13px]">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="my-2 overflow-auto rounded-xl border border-line bg-panel2/70 p-3 font-mono text-[12.5px]">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-accent/50 pl-3 text-dim">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function Bubble({ turn }: { turn: Turn }) {
  const t = useT();
  const isUser = turn.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10 text-accent">
          <Bot size={15} />
        </div>
      )}
      <div className={`max-w-[88%] ${isUser ? "order-first" : ""}`}>
        <div
          className={`mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-faint ${
            isUser ? "text-right" : ""
          }`}
        >
          {isUser ? t("assistant.you") : t("assistant.bot")}
        </div>
        <div
          className={`rounded-2xl border px-4 py-3.5 shadow-[0_14px_32px_-28px_rgba(15,23,42,0.5)] ${
            isUser
              ? "border-accent/30 bg-accent/10 text-text"
              : turn.error
                ? "border-danger/35 bg-danger/8 text-danger"
                : "border-line/90 bg-panel2/55 text-text"
          }`}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap text-[14.5px] leading-[1.7]">
              {turn.content}
            </div>
          ) : (
            <MessageMarkdown content={turn.content} />
          )}
        </div>
        {turn.steps && turn.steps.length > 0 && <Steps steps={turn.steps} />}
        {turn.usage &&
          (turn.usage.prompt_tokens > 0 || turn.usage.completion_tokens > 0) && (
            <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-faint">
              <Gauge size={12} />
              <span>
                {t("assistant.usage", {
                  input: turn.usage.prompt_tokens,
                  output: turn.usage.completion_tokens,
                })}
              </span>
            </div>
          )}
      </div>
      {isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border border-line bg-panel2 text-[12px] font-medium text-dim">
          {t("assistant.you").slice(0, 1)}
        </div>
      )}
    </div>
  );
}

function ToolGlyph({ tool }: { tool: string }) {
  const size = 16;
  if (tool === "list_ports") return <Network size={size} />;
  if (tool === "cost_summary") return <Wallet size={size} />;
  if (tool === "list_tasks") return <ListChecks size={size} />;
  if (tool === "calculate") return <Calculator size={size} />;
  if (tool === "search_knowledge") return <BookOpen size={size} />;
  if (tool === "current_date") return <CalendarDays size={size} />;
  if (tool === "create_task") return <Plus size={size} />;
  if (tool === "workbench_context") return <Layers3 size={size} />;
  return <Wrench size={size} />;
}

function parseResult(step: AssistantStep): Record<string, unknown> {
  try {
    const value = JSON.parse(step.result);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toolSummary(
  step: AssistantStep,
  t: (key: string, vars?: Record<string, string | number>) => string
) {
  if (!step.ok) return t("assistant.toolFailed");
  const data = parseResult(step);
  if (step.tool === "list_ports") {
    const listening = Array.isArray(data.listening) ? data.listening.length : 0;
    return t("assistant.resultPorts", { count: listening });
  }
  if (step.tool === "cost_summary") {
    return t("assistant.resultCost", {
      cost: formatUsd(Number(data.month_cost ?? 0)),
    });
  }
  if (step.tool === "list_tasks") {
    return t("assistant.resultTasks", { count: Number(data.count ?? 0) });
  }
  if (step.tool === "search_knowledge") {
    return t("assistant.resultKnowledge", { count: Number(data.count ?? 0) });
  }
  if (step.tool === "calculate") {
    return t("assistant.resultCalculated", {
      value: String(data.text ?? data.result ?? "—"),
    });
  }
  if (step.tool === "current_date") {
    return String(data.date ?? "—");
  }
  if (step.tool === "workbench_context") {
    return t("assistant.resultContext", {
      open: Number(data.tasks_open ?? 0),
      projects: Number(data.projects ?? 0),
    });
  }
  if (step.tool === "create_task") {
    return t("assistant.resultCreated");
  }
  return t("assistant.toolDone");
}

function prettyPayload(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function Steps({ steps }: { steps: AssistantStep[] }) {
  const t = useT();
  const failed = steps.filter((step) => !step.ok).length;
  return (
    <details className="group mt-3 overflow-hidden rounded-2xl border border-line/80 bg-panel2/30">
      <summary className="flex cursor-pointer select-none items-center gap-2.5 px-3.5 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-accent/20 bg-accent/8 text-accent">
          <Terminal size={15} />
        </span>
        <span className="text-[13px] font-semibold text-text">
          {t("assistant.toolCalls", { count: steps.length })}
        </span>
        {failed > 0 && (
          <Badge tone="danger" className="text-[11px]">
            {failed} {t("assistant.toolFailed")}
          </Badge>
        )}
        <ChevronDown
          size={15}
          className="ml-auto text-faint transition-transform group-open:rotate-180"
        />
      </summary>
      <ul className="space-y-2 border-t border-line/60 p-2.5">
        {steps.map((step, index) => (
          <li key={index} className="rounded-xl border border-line/70 bg-panel/75 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-panel2 text-accent">
                <ToolGlyph tool={step.tool} />
              </span>
              <span className="text-[13.5px] font-semibold text-text">
                {t(`assistant.toolName.${step.tool}`)}
              </span>
              <Badge tone={step.ok ? "ok" : "danger"} className="text-[11px]">
                {step.ok ? t("assistant.toolDone") : t("assistant.toolFailed")}
              </Badge>
              <span className="ml-auto num text-[12px] text-dim">
                {toolSummary(step, t)}
              </span>
            </div>
            <details className="group/step mt-2">
              <summary className="flex cursor-pointer select-none items-center gap-1 text-[11.5px] text-faint hover:text-accent">
                {t("assistant.toolDetails")}
                <ChevronRight
                  size={13}
                  className="transition-transform group-open/step:rotate-90"
                />
              </summary>
              <div className="mt-2 space-y-2">
                <div>
                  <div className="mb-1 text-[10.5px] font-medium uppercase tracking-[0.1em] text-faint">
                    {t("assistant.toolArgs")}
                  </div>
                  <pre className="max-h-40 overflow-auto rounded-lg border border-line/60 bg-panel2/60 p-2.5 font-mono text-[11.5px] leading-relaxed text-dim">
                    {prettyPayload(step.arguments)}
                  </pre>
                </div>
                <div>
                  <div className="mb-1 text-[10.5px] font-medium uppercase tracking-[0.1em] text-faint">
                    {t("assistant.toolResult")}
                  </div>
                  <pre className="max-h-56 overflow-auto rounded-lg border border-line/60 bg-panel2/60 p-2.5 font-mono text-[11.5px] leading-relaxed text-dim">
                    {prettyPayload(step.result)}
                  </pre>
                </div>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </details>
  );
}
