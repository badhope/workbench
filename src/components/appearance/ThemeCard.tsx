import { Copy, Pencil, Trash2 } from "lucide-react";
import { useT } from "../../lib/i18n";
import { describeTheme, swatchOf } from "../../lib/theme/presets";
import { mix, type ThemeInput } from "../../lib/theme/tokens";
import { readableOn } from "../../lib/theme/readable";

/**
 * 一张主题卡：迷你预览 + 名称 + 悬停时的编辑/复制/删除。
 *
 * 抽出来的原因：AppearancePanel 原本 425 行，其中这个卡片的内联 JSX
 * 就占 120+ 行（三套按钮 + 预览结构），拆开后父组件只剩编排。
 */
export function ThemeCard({
  theme,
  active,
  onPick,
  onEdit,
  onCopy,
  onDelete,
}: {
  theme: ThemeInput;
  active: boolean;
  onPick: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [bg, panel, accent, text] = swatchOf(theme);
  return (
    <div
      className={`group relative overflow-hidden rounded-[var(--radius-btn)] border text-left transition-colors ${
        active ? "border-accent" : "border-line hover:border-accent/40"
      }`}
      style={{ background: panel }}
    >
      <button
        type="button"
        onClick={onPick}
        aria-pressed={active}
        aria-label={theme.name}
        className="block w-full text-left"
      >
        <div className="flex h-12 gap-1 p-1.5" style={{ background: bg }}>
          <div
            className="w-1/4"
            style={{
              background: panel,
              borderRadius: Math.min(6, theme.radiusBtn),
              border: `1px solid ${mix(accent, bg, 0.7)}`,
            }}
          />
          <div className="flex flex-1 flex-col justify-center gap-1">
            <div
              className="h-1 w-3/4"
              style={{ background: text, opacity: 0.5, borderRadius: 2 }}
            />
            <div className="flex gap-1">
              <div
                className="h-4 flex-1"
                style={{
                  background: panel,
                  border: `1px solid ${mix(accent, bg, 0.75)}`,
                  borderRadius: Math.min(8, theme.radiusCard),
                }}
              />
              <div
                className="h-4 w-1/3"
                style={{
                  background: accent,
                  opacity: 0.85,
                  borderRadius: Math.min(8, theme.radiusBtn),
                }}
              />
            </div>
          </div>
        </div>
        <div className="px-2 py-1.5" style={{ background: panel }}>
          <div className="flex items-center gap-1.5">
            <span
              className="truncate text-[11.5px] font-semibold"
              style={{ color: text }}
            >
              {theme.name}
            </span>
            {theme.builtin ? (
              <span
                className="ml-auto h-1 w-1 rounded-full"
                style={{ background: accent }}
              />
            ) : (
              <span
                className="ml-auto text-[9px]"
                style={{ color: readableOn(text, panel, 4.6) }}
              >
                {t("settings.themeCustom")}
              </span>
            )}
          </div>
          <div
            className="mt-0.5 truncate text-[9.5px]"
            style={{ color: readableOn(text, panel, 4.6) }}
          >
            {describeTheme(theme)}
          </div>
        </div>
      </button>

      <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          title={t("settings.themeEdit")}
          aria-label={t("settings.themeEdit")}
          className="rounded bg-black/45 p-1 text-white backdrop-blur hover:bg-black/70"
          onClick={onEdit}
        >
          <Pencil size={10} />
        </button>
        <button
          type="button"
          title={t("settings.themeNew")}
          aria-label={t("settings.themeNew")}
          className="rounded bg-black/45 p-1 text-white backdrop-blur hover:bg-black/70"
          onClick={onCopy}
        >
          <Copy size={10} />
        </button>
        {!theme.builtin && (
          <button
            type="button"
            title={t("settings.themeDelete")}
            aria-label={t("settings.themeDelete")}
            className="rounded bg-black/45 p-1 text-white backdrop-blur hover:bg-red-600/80"
            onClick={onDelete}
          >
            <Trash2 size={10} />
          </button>
        )}
      </div>
    </div>
  );
}
