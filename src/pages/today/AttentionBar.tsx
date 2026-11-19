import { useT } from "../../lib/i18n";
import type { AttentionCounts, TaskScope } from "../../lib/workbench";

const TONES = {
  danger: "border-danger/30 bg-danger/8 text-danger",
  warn: "border-warn/30 bg-warn/8 text-warn",
  accent: "border-accent/30 bg-accent/8 text-accent",
  dim: "border-line bg-panel2/50 text-dim",
} as const;

function AttentionChip({
  label,
  tone,
  active,
  onClick,
}: {
  label: string;
  tone: keyof typeof TONES;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors hover:brightness-110 ${
        active ? TONES[tone] : "border-line bg-transparent text-faint"
      }`}
    >
      {label}
    </button>
  );
}

export function AttentionBar({
  counts,
  onOpen,
}: {
  counts: AttentionCounts;
  onOpen: (scope: TaskScope) => void;
}) {
  const t = useT();
  const total =
    counts.overdue + counts.today + counts.doing + counts.inbox + counts.blocked;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-[11px] font-medium tracking-[0.04em] text-faint">
        {t("today.attention")}
      </span>
      <AttentionChip
        tone="danger"
        label={t("today.overdue", { count: counts.overdue })}
        active={counts.overdue > 0}
        onClick={() => onOpen("today")}
      />
      <AttentionChip
        tone="warn"
        label={t("today.dueToday", { count: counts.today })}
        active={counts.today > 0}
        onClick={() => onOpen("today")}
      />
      <AttentionChip
        tone="accent"
        label={t("today.doing", { count: counts.doing })}
        active={counts.doing > 0}
        onClick={() => onOpen("today")}
      />
      <AttentionChip
        tone="danger"
        label={t("today.blocked", { count: counts.blocked })}
        active={counts.blocked > 0}
        onClick={() => onOpen("blocked")}
      />
      <AttentionChip
        tone="dim"
        label={t("today.inboxCount", { count: counts.inbox })}
        active={counts.inbox > 0}
        onClick={() => onOpen("inbox")}
      />
      {total === 0 && (
        <span className="text-[11px] text-faint">{t("today.allClear")}</span>
      )}
    </div>
  );
}
