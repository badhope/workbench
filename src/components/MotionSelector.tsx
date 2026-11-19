import { useT } from "../lib/i18n";
import type { MotionLevel } from "../lib/theme/apply";

/** 动效三档（关/标准/满格）。顺序即展示顺序，off 在最前。 */
const MOTION_CHOICES: { id: MotionLevel; key: string }[] = [
  { id: "off", key: "settings.motionOff" },
  { id: "standard", key: "settings.motionStandard" },
  { id: "rich", key: "settings.motionRich" },
];

/**
 * 动效档位按钮组：外观面板与首启引导共用。
 * 之前两处各自维护一份 MOTIONS 和按钮样式，新增档位必然漏一处。
 */
export function MotionSelector({
  value,
  onChange,
  markLevel = false,
}: {
  value: MotionLevel;
  onChange: (level: MotionLevel) => void;
  markLevel?: boolean;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-1.5">
      {MOTION_CHOICES.map((m) => (
        <button
          key={m.id}
          type="button"
          data-motion-level={markLevel ? m.id : undefined}
          aria-pressed={value === m.id}
          onClick={() => onChange(m.id)}
          className={`t-btn border px-2.5 py-1 text-[11.5px] font-medium ${
            value === m.id
              ? "border-accent bg-accent text-[var(--color-on-accent)]"
              : "border-line bg-panel2/70 text-dim hover:text-text"
          }`}
        >
          {t(m.key)}
        </button>
      ))}
    </div>
  );
}
