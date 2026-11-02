import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, RefreshCw, Trash2 } from "lucide-react";
import { useStore } from "../lib/store";
import { isTauri, readLogs, clearLogs } from "../lib/api";
import { demoBundle } from "../lib/demo";
import { Btn } from "../ui";
import { getLang, t as translate, useT } from "../lib/i18n";

/**
 * Log viewer — displays the Rust backend logs without needing the DevTools console.
 *
 * 日志是外部系统（后端文件）的数据：拉取本身是异步副作用，setState 落在
 * promise 回调里而非 effect 同步体，因此不会引发级联渲染。
 */
export default function Logs() {
  const t = useT();
  const setToast = useStore((s) => s.setToast);
  const [content, setContent] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    // 浏览器预览没有后端日志文件：给一段标注清楚的样例，
    // 而不是把整页渲染成「不可用」——那看起来像功能坏了。
    if (!isTauri()) {
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

  const handleClear = async () => {
    try {
      await clearLogs();
      setContent(t("logs.cleared"));
      setToast(t("logs.clearedToast"));
    } catch {
      setToast(t("logs.clearFailed"));
    }
  };

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

      <pre
        ref={preRef}
        className="mt-3 flex-1 overflow-auto rounded-[var(--radius-card)] border border-line/80 bg-[color-mix(in_srgb,var(--color-bg)_82%,black)] p-4 font-mono text-[11.5px] leading-[1.7] text-dim"
      >
        {content || t("logs.empty")}
      </pre>
    </div>
  );
}
