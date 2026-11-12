import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CornerDownLeft, Search } from "lucide-react";
import { useStore } from "../lib/store";
import { useShallow } from "zustand/react/shallow";
import { rankCommands, type CommandItem } from "../lib/commandSearch";
import { useT } from "../lib/i18n";
import { PAGES } from "../pages/registry";
import { formatBytes } from "../lib/util";
import type { ViewKey } from "../pages/registry";

interface PaletteAction extends CommandItem {
  group: string;
  hint?: string;
  run: () => void;
}

/**
 * 命令面板（Ctrl/Cmd+K）。
 *
 * 为什么需要它：应用有 9 个页面、上百个进程、几十个端口，之前每一项都要
 * 「先进页面、再在页内搜索」。命令面板把「去哪 / 看谁 / 干什么」压成一次
 * 键盘输入，这是键盘优先工具（btop、VS Code、Linear）的共同做法。
 *
 * 动作全部复用 store 已有方法：不新增 IPC，不复制页面逻辑。
 */
export function CommandPalette() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    setView,
    procs,
    ports,
    data,
    setProcQuery,
    setFocusPid,
    refreshRuntime,
    setTaskDetailId,
  } = useStore(
    useShallow((s) => ({
      setView: s.setView,
      procs: s.procs,
      ports: s.ports,
      data: s.data,
      setProcQuery: s.setProcQuery,
      setFocusPid: s.setFocusPid,
      refreshRuntime: s.refreshRuntime,
      setTaskDetailId: s.setTaskDetailId,
    }))
  );

  const actions = useMemo<PaletteAction[]>(() => {
    const nav = PAGES.map((p) => ({
      id: `nav-${p.key}`,
      label: t(`app.nav.${p.key}`),
      keywords: `${p.key} ${t(`app.title.${p.key}`)}`,
      group: t("palette.nav"),
      run: () => setView(p.key as ViewKey),
    }));
    const goProcess = (pid: number) => () => {
      setProcQuery(String(pid));
      setFocusPid(pid);
      setView("processes");
    };
    const procActions = [...procs]
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 40)
      .map((p) => ({
        id: `proc-${p.pid}`,
        label: `${p.name} · ${p.pid}`,
        keywords: `${p.pid} ${p.cmd_line}`,
        group: t("palette.processes"),
        hint: `${p.cpu.toFixed(0)}% · ${formatBytes(p.memory)}`,
        run: goProcess(p.pid),
      }));
    const portActions = [...ports]
      .filter((p) => p.state === "LISTENING" || p.state === "UDP")
      .slice(0, 40)
      .map((p) => ({
        id: `port-${p.protocol}-${p.local_port}-${p.local_addr}`,
        label: `:${p.local_port} ${p.protocol}`,
        keywords: `${p.local_port} ${p.local_addr}`,
        group: t("palette.ports"),
        hint: p.local_addr,
        run: goProcess(p.pid),
      }));
    const projectActions = data.projects.map((p) => ({
      id: `proj-${p.id}`,
      label: p.name,
      keywords: `${p.path} ${p.tags.join(" ")}`,
      group: t("palette.projects"),
      hint: p.path,
      run: () => setView("projects"),
    }));
    const taskActions = data.tasks.slice(0, 40).map((task) => ({
      id: `task-${task.id}`,
      label: task.title,
      keywords: task.tags.join(" "),
      group: t("palette.tasks"),
      hint: task.status,
      run: () => setTaskDetailId(task.id),
    }));
    const commandActions: PaletteAction[] = [
      {
        id: "cmd-refresh",
        label: t("palette.refresh"),
        keywords: "refresh reload scan",
        group: t("palette.actions"),
        run: () => void refreshRuntime(),
      },
    ];
    return [
      ...commandActions,
      ...nav,
      ...procActions,
      ...portActions,
      ...projectActions,
      ...taskActions,
    ];
  }, [
    t,
    procs,
    ports,
    data,
    setView,
    setProcQuery,
    setFocusPid,
    refreshRuntime,
    setTaskDetailId,
  ]);

  const results = useMemo(() => rankCommands(actions, query, 12), [actions, query]);

  // 全局快捷键：输入框里也生效——命令面板的意义就是随手可开。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery("");
        setActive(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // 查询变化时把高亮拉回第一项。在 change 处理器里同步归零，
  // 而不是用 effect 派生——effect 里 setState 会触发一次额外渲染。

  if (!open) return null;

  const runAt = (index: number) => {
    const action = results[index];
    if (!action) return;
    setOpen(false);
    setQuery("");
    action.run();
  };

  return (
    <div
      className="overlay-scrim fixed inset-0 z-[60] flex items-start justify-center px-3 pt-[12vh] backdrop-blur-[2px]"
      role="presentation"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.title")}
        className="t-card t-panel w-full max-w-xl overflow-hidden border border-line shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
          <Search size={14} className="shrink-0 text-dim" />
          <input
            ref={inputRef}
            value={query}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.placeholder")}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                runAt(active);
              }
            }}
            className="w-full bg-transparent text-sm text-text outline-none placeholder:text-faint"
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-faint">
            Esc
          </kbd>
        </div>
        <ul className="max-h-[46vh] overflow-y-auto py-1" role="listbox">
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-xs text-faint">
              {t("palette.empty")}
            </li>
          )}
          {results.map((item, i) => {
            const hinted = item as PaletteAction;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => runAt(i)}
                  className={`flex w-full items-center gap-3 px-3.5 py-2 text-left transition-colors ${
                    i === active ? "bg-accentsoft/60" : ""
                  }`}
                >
                  <span className="w-[52px] shrink-0 truncate text-[10px] uppercase tracking-wide text-faint">
                    {hinted.group}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-text">
                    {item.label}
                  </span>
                  {hinted.hint && (
                    <span className="max-w-[40%] shrink-0 truncate font-mono text-[10.5px] text-dim">
                      {hinted.hint}
                    </span>
                  )}
                  {i === active && (
                    <CornerDownLeft size={11} className="shrink-0 text-accent" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-3 border-t border-line px-3.5 py-2 text-[10.5px] text-faint">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-line px-1">↑</kbd>
            <kbd className="rounded border border-line px-1">↓</kbd>
            {t("palette.hintMove")}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-line px-1">↵</kbd>
            {t("palette.hintRun")}
          </span>
          <span className="ml-auto flex items-center gap-1">
            <ArrowRight size={10} /> {t("palette.hintOpen")}
          </span>
        </div>
      </div>
    </div>
  );
}
