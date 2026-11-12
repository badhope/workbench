import {
  BookOpen,
  Code2,
  FolderKanban,
  PenLine,
  SlidersHorizontal,
  User,
  type LucideIcon,
} from "lucide-react";
import type { WorkMode } from "../lib/workModes";
import { WORK_MODES, toggleWorkMode } from "../lib/workModes";
import { useT } from "../lib/i18n";

const ICONS: Record<WorkMode, LucideIcon> = {
  development: Code2,
  project: FolderKanban,
  content: PenLine,
  research: BookOpen,
  personal: User,
  custom: SlidersHorizontal,
};

/**
 * 工作方式多选网格。
 *
 * 首启和设置复用同一组件，避免两处选项语义漂移。选择只影响默认呈现，
 * 不在这里触发扫描、权限或任何系统能力。
 */
export function WorkModeChoices({
  value,
  onChange,
}: {
  value: WorkMode[];
  onChange: (next: WorkMode[]) => void;
}) {
  const t = useT();
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label={t("workMode.title")}>
      {WORK_MODES.map((mode) => {
        const active = value.includes(mode.id);
        const Icon = ICONS[mode.id];
        return (
          <button
            key={mode.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(toggleWorkMode(value, mode.id))}
            className={`flex min-w-0 items-start gap-2.5 rounded-[var(--radius-btn)] border px-3 py-2.5 text-left transition-colors ${
              active
                ? "border-accent bg-accent/8"
                : "border-line bg-panel2/50 hover:border-accent/40"
            }`}
          >
            <span
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border ${
                active
                  ? "border-accent/40 bg-accent/12 text-accent"
                  : "border-line bg-panel text-dim"
              }`}
            >
              <Icon size={14} strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[12.5px] font-medium">
                  {t(mode.labelKey)}
                </span>
                {active && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                )}
              </span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-dim">
                {t(mode.hintKey)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
