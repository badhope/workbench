import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Columns3 } from "lucide-react";
import { useT } from "../../lib/i18n";
import { PROC_COLUMNS, moveProcColumn, type ProcColumnId } from "../../lib/procColumns";

const LABEL: Record<ProcColumnId, string> = {
  pid: "PID",
  name: "procs.colName",
  cpu: "CPU",
  memory: "procs.colMemory",
  status: "procs.colStatus",
  started: "procs.colStarted",
  path: "procs.colPath",
  action: "procs.colAction",
};

/**
 * 进程表列设置：显示/隐藏 + 顺序。
 *
 * 只做轻量弹层，不引入拖拽库：上下箭头在触屏和键盘上都比拖拽稳。
 * 隐藏列仍保留在「全部列」清单里，用户改主意时能原路加回来。
 */
export function ColumnsMenu({
  columns,
  onChange,
}: {
  columns: ProcColumnId[];
  onChange: (next: ProcColumnId[]) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (id: ProcColumnId) => {
    if (columns.includes(id)) {
      // 至少留一列，否则表格只剩展开箭头，用户会以为表坏了。
      if (columns.length === 1) return;
      onChange(columns.filter((x) => x !== id));
    } else {
      onChange([...columns, id]);
    }
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t("procs.columns")}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-2 py-1 text-xs text-dim transition-colors hover:text-text"
      >
        <Columns3 size={13} />
        {t("procs.columns")}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("procs.columns")}
          className="absolute right-0 top-full z-30 mt-1 w-56 rounded-lg border border-line bg-panel p-2 shadow-xl"
        >
          <div className="px-1 pb-1.5 text-[11px] text-faint">
            {t("procs.columnsHint")}
          </div>
          <ul className="flex flex-col gap-0.5">
            {PROC_COLUMNS.map((id) => {
              const checked = columns.includes(id);
              const index = columns.indexOf(id);
              return (
                <li
                  key={id}
                  className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-panel2"
                >
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={checked && columns.length === 1}
                      onChange={() => toggle(id)}
                      className="accent-[var(--accent)]"
                    />
                    <span className={checked ? "" : "text-faint"}>{t(LABEL[id])}</span>
                  </label>
                  {checked && (
                    <span className="flex items-center gap-0.5">
                      <button
                        type="button"
                        aria-label={t("procs.columnUp")}
                        disabled={index <= 0}
                        onClick={() => onChange(moveProcColumn(columns, id, -1))}
                        className="rounded p-0.5 text-dim hover:text-text disabled:opacity-30"
                      >
                        <ArrowUp size={11} />
                      </button>
                      <button
                        type="button"
                        aria-label={t("procs.columnDown")}
                        disabled={index >= columns.length - 1}
                        onClick={() => onChange(moveProcColumn(columns, id, 1))}
                        className="rounded p-0.5 text-dim hover:text-text disabled:opacity-30"
                      >
                        <ArrowDown size={11} />
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => onChange([...PROC_COLUMNS])}
            className="mt-1.5 w-full rounded border-t border-line pt-1.5 text-left text-[11px] text-dim hover:text-text"
          >
            {t("procs.columnsReset")}
          </button>
        </div>
      )}
    </div>
  );
}
