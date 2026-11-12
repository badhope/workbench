import { useEffect, useMemo, useState } from "react";
import { Check, Maximize2, Pin, PinOff, Plus, X } from "lucide-react";
import { useStore } from "../lib/store";
import { useShallow } from "zustand/react/shallow";
import { useAppRuntime } from "../lib/useAppRuntime";
import { useT } from "../lib/i18n";
import { BrandMark } from "./BrandMark";
import { ProgressRing } from "./ProgressRing";
import { dueLabel } from "../lib/util";
import {
  explicitNextStep,
  nextTaskForProject,
  pickCurrentProject,
  projectProgress,
  tasksForToday,
} from "../lib/workbench";
import {
  closeCurrentWindow,
  isTauri,
  setAlwaysOnTop,
  showMainWindow,
} from "../lib/api";
import { subscribeDataChanged } from "../lib/dataSync";

/**
 * 工作小窗：只保留“当前项目 + 今天 + 快速记录”。
 *
 * 与主窗口共用 store / IPC / HTTP 数据层；通过 BroadcastChannel 通知对方
 * 重新加载，而不是各自维护一份内存快照。窗口按钮在浏览器预览下降级为
 * window.opener / window.close。
 */
export default function MiniWorkbench() {
  const t = useT();
  useAppRuntime();
  const {
    data,
    addTask,
    moveTask,
    refreshData,
  } = useStore(
    useShallow((s) => ({
      data: s.data,
      addTask: s.addTask,
      moveTask: s.moveTask,
      refreshData: s.refreshData,
    }))
  );
  const [title, setTitle] = useState("");
  const [added, setAdded] = useState(false);
  const [onTop, setOnTop] = useState(false);

  useEffect(
    () => subscribeDataChanged(() => void refreshData()),
    [refreshData]
  );

  const current = useMemo(
    () => pickCurrentProject(data.projects, data.tasks),
    [data.projects, data.tasks]
  );
  const progress = current ? projectProgress(current.id, data.tasks) : null;
  const next = current ? nextTaskForProject(current.id, data.tasks) : null;
  const today = useMemo(() => tasksForToday(data.tasks).slice(0, 5), [data.tasks]);

  const add = () => {
    const value = title.trim();
    if (!value) return;
    if (
      addTask({
        title: value,
        status: "todo",
        priority: "normal",
        project_id: current?.id ?? null,
      })
    ) {
      setTitle("");
      setAdded(true);
      window.setTimeout(() => setAdded(false), 1600);
    }
  };

  const complete = (id: string) => {
    moveTask(id, "done");
  };

  const expand = async () => {
    if (isTauri()) {
      try {
        await showMainWindow();
        await closeCurrentWindow();
        return;
      } catch {
        /* 落到浏览器关闭路径 */
      }
    }
    window.opener?.focus();
    window.close();
  };

  const close = async () => {
    if (isTauri()) {
      try {
        await closeCurrentWindow();
        return;
      } catch {
        /* 落到浏览器关闭路径 */
      }
    }
    window.close();
  };

  const togglePin = async () => {
    const nextValue = !onTop;
    setOnTop(nextValue);
    try {
      await setAlwaysOnTop(nextValue);
    } catch {
      setOnTop(!nextValue);
    }
  };

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line/80 bg-panel/80 px-3">
        <BrandMark className="h-4 w-5 text-accent" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
          {t("mini.title")}
        </span>
        {isTauri() && (
          <button
            type="button"
            onClick={() => void togglePin()}
            title={onTop ? t("mini.unpin") : t("mini.pin")}
            aria-label={onTop ? t("mini.unpin") : t("mini.pin")}
            className={`rounded p-1 transition-colors ${
              onTop ? "text-accent" : "text-faint hover:text-text"
            }`}
          >
            {onTop ? <Pin size={13} /> : <PinOff size={13} />}
          </button>
        )}
        <button
          type="button"
          onClick={() => void expand()}
          title={t("mini.expand")}
          aria-label={t("mini.expand")}
          className="rounded p-1 text-faint transition-colors hover:text-text"
        >
          <Maximize2 size={13} />
        </button>
        <button
          type="button"
          onClick={() => void close()}
          title={t("mini.close")}
          aria-label={t("mini.close")}
          className="rounded p-1 text-faint transition-colors hover:text-text"
        >
          <X size={14} />
        </button>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        <section className="rounded-[var(--radius-card)] border border-line/80 bg-panel p-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-faint">{t("mini.current")}</span>
            {current && progress && (
              <span className="num ml-auto text-[10px] text-faint">
                {progress.done}/{progress.total}
              </span>
            )}
          </div>
          {current && progress ? (
            <div className="mt-1 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">
                  {current.name}
                </div>
                <div className="mt-1 truncate text-[11px] text-dim">
                  {next
                    ? explicitNextStep(next) || next.title
                    : t("projects.noOpenTasks")}
                </div>
              </div>
              <ProgressRing percent={progress.percent} size={44} strokeWidth={4} />
            </div>
          ) : (
            <div className="mt-1 text-[11.5px] text-dim">{t("today.noProjectHint")}</div>
          )}
        </section>

        <section className="flex flex-col">
          <div className="flex items-center justify-between border-b border-line/70 pb-1.5">
            <h2 className="text-[11px] font-medium text-faint">{t("mini.today")}</h2>
            <span className="num text-[10px] text-faint">{today.length}</span>
          </div>
          {today.length === 0 ? (
            <div className="py-4 text-center text-[11px] text-faint">
              {t("mini.empty")}
            </div>
          ) : (
            <ul className="flex flex-col">
              {today.map((task) => {
                const due = dueLabel(task.due);
                return (
                  <li
                    key={task.id}
                    className="flex items-center gap-2 border-b border-line/40 py-1.5 last:border-0"
                  >
                    <button
                      type="button"
                      onClick={() => complete(task.id)}
                      aria-label={t("today.markDone")}
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-dim/50 text-transparent transition-colors hover:border-ok hover:text-ok"
                    >
                      <Check size={10} strokeWidth={3} />
                    </button>
                    <span className="min-w-0 flex-1 truncate text-[11.5px]">
                      {task.title}
                    </span>
                    <span className="shrink-0 text-[9.5px] text-faint">
                      {due.text}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      <form
        className="relative flex shrink-0 items-center gap-1.5 border-t border-line/80 bg-panel/80 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          className="min-w-0 flex-1 rounded-[var(--radius-btn)] border border-line bg-panel2 px-2 py-1.5 text-[12px] text-text outline-none placeholder:text-faint focus:border-accent/50"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("mini.quickPlaceholder")}
          aria-label={t("mini.quickPlaceholder")}
        />
        <button
          type="submit"
          aria-label={t("today.quickAdd")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-btn)] bg-accent text-[var(--color-on-accent)]"
        >
          <Plus size={14} />
        </button>
        {added && (
          <span className="absolute bottom-11 right-3 rounded bg-panel px-2 py-1 text-[10px] text-ok shadow">
            {t("mini.added")}
          </span>
        )}
      </form>
    </div>
  );
}
