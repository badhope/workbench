import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, RefreshCw, Trash2 } from "lucide-react";
import { useStore } from "../lib/store";
import { isBackend, readLogs, clearLogs } from "../lib/api";
import { demoBundle } from "../lib/demo";
import { Btn, ConfirmDialog } from "../ui";
import { getLang, t as translate, useT } from "../lib/i18n";

/**
 * Log viewer — displays the Rust backend logs without needing the DevTools console.
 *
 * 日志是外部系统（后端文件）的数据：拉取本身是异步副作用，setState 落在
 * promise 回调里而非 effect 同步体，因此不会引发级联渲染。
 */
/** 日志级别筛选项。日志行来自 Rust tracing 输出，级别是大写的英文单词。 */
type LogLevel = "all" | "error" | "warn" | "info" | "debug";

const LOG_LEVELS: LogLevel[] = ["all", "error", "warn", "info", "debug"];

/**
 * 从一行日志里识别级别。匹配不到任何已知级别时按 debug 处理：
 * 多行堆栈、空行这类“正文”不该因为筛选错误级别而被藏掉。
 */
function levelOf(line: string): Exclude<LogLevel, "all"> {
  if (/\bERROR\b/.test(line)) return "error";
  if (/\bWARN\b/.test(line)) return "warn";
  if (/\bINFO\b/.test(line)) return "info";
  return "debug";
}

export default function Logs() {
  const t = useT();
  const setToast = useStore((s) => s.setToast);
  const [content, setContent] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  // 排障时最常见的两个诉求：只看错误、搜关键字。
  // 没有它们，几百行日志里找一条 ERROR 只能靠肉眼滚。
  const [level, setLevel] = useState<LogLevel>("all");
  const [query, setQuery] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    // 没有后端（纯静态预览）时给一段标注清楚的样例，
    // 而不是把整页渲染成「不可用」——那看起来像功能坏了。
    // Web 模式（连 HTTP 后端）日志端点未开放，同样落到这个分支。
    if (!isBackend()) {
      setContent(demoBundle(getLang()).logs);
      return;
    }
    try {
      setContent(await readLogs(500));
    } catch {
      setContent(translate("logs.unavailable"));
    }
  }, []);

  useEffect(() => {
    // 日志来自外部系统（后端日志文件），effect 在这里订阅它属正当用法。
    // 该规则把「effect 内立即调用会 setState 的异步函数」也标为级联渲染风险；
    // 实际 setState 发生在 await 之后的微任务里，不在同步渲染路径上。
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 见上
    void load();
  }, [load]);

  // 自动刷新（每 3 秒）。窗口隐藏时暂停：读日志文件是纯 IO，
  // 没人看的时候继续轮询只是白耗磁盘。
  useEffect(() => {
    if (!autoRefresh) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id) return;
      id = setInterval(() => void load(), 3000);
    };
    const stop = () => {
      if (id) clearInterval(id);
      id = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void load();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [autoRefresh, load]);

  const handleClear = () => {
    setConfirmClear(true);
  };

  const doClear = async () => {
    setConfirmClear(false);
    try {
      await clearLogs();
      setContent(t("logs.cleared"));
      setToast(t("logs.clearedToast"));
    } catch {
      setToast(t("logs.clearFailed"));
    }
  };

  const lines = useMemo(() => content.split("\n"), [content]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter((line) => {
      if (level !== "all" && levelOf(line) !== level) return false;
      if (q && !line.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [lines, level, query]);

  const counts = useMemo(() => {
    let err = 0;
    let warn = 0;
    for (const line of lines) {
      const lv = levelOf(line);
      if (lv === "error") err++;
      else if (lv === "warn") warn++;
    }
    return { err, warn };
  }, [lines]);

  const preRef = useRef<HTMLPreElement>(null);

  // 自动刷新后滚动到底
  useEffect(() => {
    if (autoRefresh && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [content, autoRefresh]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line/70 pb-3">
        <FileText size={14} className="text-accent" />
        <span className="section-title">{t("logs.title")}</span>
        <label className="ml-1 flex items-center gap-1.5 text-[11px] text-dim">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="accent-accent"
          />
          {t("logs.autoRefresh")}
        </label>
        <div className="ml-auto flex gap-2">
          <Btn onClick={load}>
            <RefreshCw size={14} /> {t("logs.refresh")}
          </Btn>
          <Btn variant="danger" onClick={handleClear}>
            <Trash2 size={14} /> {t("logs.clear")}
          </Btn>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title={t("logs.clear")}
        body={t("logs.clearConfirm")}
        confirmLabel={t("logs.clear")}
        cancelLabel={t("logs.title")}
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => void doClear()}
      />

      {/* 筛选条：关键字 + 级别。过滤只发生在渲染层，不重新读文件。 */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("logs.search")}
          className="w-56 rounded-[var(--radius-btn)] border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-text placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <div
          role="group"
          aria-label={t("logs.level")}
          className="flex items-center gap-1"
        >
          {LOG_LEVELS.map((lv) => {
            const active = level === lv;
            const badge =
              lv === "error" && counts.err > 0
                ? counts.err
                : lv === "warn" && counts.warn > 0
                  ? counts.warn
                  : null;
            return (
              <button
                key={lv}
                onClick={() => setLevel(lv)}
                aria-pressed={active}
                className={`rounded-[var(--radius-btn)] px-2 py-1 text-[11px] transition-colors ${
                  active
                    ? "bg-accentsoft font-medium text-accent"
                    : "text-dim hover:text-text"
                }`}
              >
                {t(`logs.${lv}`)}
                {badge !== null && <span className="num ml-1">{badge}</span>}
              </button>
            );
          })}
        </div>
        <span className="num ml-auto text-[10.5px] text-faint">
          {t("logs.shown", { shown: shown.length, total: lines.length })}
        </span>
      </div>

      {/*
       * 日志区底色用 panel2（主题派生色），而不是「bg 混黑」。
       * 原来写死 `color-mix(bg 82%, black)`：暗色下只是更深的黑，没问题；
       * 但亮色主题（默认 Frost）上等于把白底压成灰底，而文字仍是按亮底
       * 求解的 dim 色 —— 实测时间戳掉到 4.02:1，没过 AA。
       * panel2 由主题按「面板与底色的中间调」推导，两种极性都成立。
       */}
      <pre
        ref={preRef}
        className="mt-3 flex-1 overflow-auto rounded-[var(--radius-card)] border border-line/80 bg-panel2 p-4 font-mono text-[11.5px] leading-[1.7] text-text/90"
      >
        {(query.trim() || level !== "all" ? shown.join("\n") : content) ||
          t("logs.empty")}
      </pre>
    </div>
  );
}
