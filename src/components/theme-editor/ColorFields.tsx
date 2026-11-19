import { useT } from "../../lib/i18n";
import {
  contrastRatio,
  deriveAccent2,
  ensureTextContrast,
  type ThemeInput,
} from "../../lib/theme/tokens";

/**
 * 颜色编辑区。
 *
 * 拆成独立组件的原因：整个编辑器 228 行，颜色/形状/预览三块互不依赖，
 * 拆开后每块都能单独看、单独测（也才过得了"单函数≤120 行"的门禁）。
 */
export function ColorFields({
  local,
  patch,
}: {
  local: ThemeInput;
  patch: (p: Partial<ThemeInput>) => void;
}) {
  const t = useT();
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium text-dim">
        {t("settings.editorColors")}
      </div>
      <div className="flex flex-col gap-1.5">
        <ColorRow local={local} patch={patch} field="bg" label={t("settings.editorBg")} />
        <ColorRow
          local={local}
          patch={patch}
          field="panel"
          label={t("settings.editorPanel")}
        />
        <ColorRow
          local={local}
          patch={patch}
          field="text"
          label={t("settings.editorText")}
          against={local.bg}
        />
        <ColorRow
          local={local}
          patch={patch}
          field="accent"
          label={t("settings.editorAccent")}
          against={local.bg}
        />
        <ColorRow
          local={local}
          patch={patch}
          field="accent2"
          label={t("settings.editorAccent2")}
          against={local.bg}
          fallback={deriveAccent2(local.accent)}
        />
      </div>

      {/* 渐变开关：关掉后 --gradient-accent 退化为 accent 纯色，即时反映在预览里 */}
      <label className="mt-2 flex items-center gap-2 text-[11.5px] text-dim">
        <input
          type="checkbox"
          checked={local.gradientAccent !== false}
          onChange={(e) => patch({ gradientAccent: e.target.checked })}
        />
        {t("settings.editorGradient")}
      </label>

      <div className="mb-1.5 mt-3 text-[11px] font-medium text-dim">
        {t("settings.editorSemantic")}
      </div>
      <div className="flex flex-col gap-1.5">
        <ColorRow
          local={local}
          patch={patch}
          field="ok"
          label={t("settings.editorOk")}
          against={local.bg}
          fallback={local.dark ? "#3ecf8e" : "#0b7a54"}
        />
        <ColorRow
          local={local}
          patch={patch}
          field="warn"
          label={t("settings.editorWarn")}
          against={local.bg}
          fallback={local.dark ? "#f5b544" : "#a86400"}
        />
        <ColorRow
          local={local}
          patch={patch}
          field="danger"
          label={t("settings.editorDanger")}
          against={local.bg}
          fallback={local.dark ? "#ff6b6b" : "#c02b2b"}
        />
      </div>

      <label className="mt-2 flex items-center gap-2 text-[11.5px] text-dim">
        <input
          type="checkbox"
          checked={local.dark}
          onChange={(e) => patch({ dark: e.target.checked })}
        />
        {t("settings.editorDark")}
      </label>
    </div>
  );
}

/**
 * 一行颜色：色块 + 名称 + 十六进制 + 对比度读数。
 *
 * 对比度是**用户可见的**产品能力，而不是只存在于测试里的内部约束：
 * 用户把文字色调到 3.2:1 时，界面上立刻出现红色读数，比事后看到
 * 「某处文字看不清」再去猜原因有用得多。
 */
function ColorRow({
  local,
  patch,
  field,
  label,
  against,
  fallback,
}: {
  local: ThemeInput;
  patch: (p: Partial<ThemeInput>) => void;
  field: "bg" | "panel" | "text" | "accent" | "accent2" | "ok" | "warn" | "danger";
  label: string;
  against?: string;
  fallback?: string;
}) {
  const value = String(local[field] ?? fallback ?? "#000000");
  const ratio = against ? contrastRatio(value, against) : null;
  const ok = ratio === null || ratio >= 4.5;

  /*
   * 对比度不足时主题系统会把这个色往深/往浅调一档（见 tokens.ts 的
   * ensureTextContrast）。这本身是对的——不能让用户保存一套看不清的主题。
   * 但先前 UI 只显示「输入值 + 输入值的理论对比度」，用户看到 3.2:1 红了、
   * 保存后却发现颜色跟自己选的不一样，不知道发生了什么。
   *
   * 所以在颜色被调整时补一行「实际生效 #xxxxxx」，把这件事说出来，
   * 而不是让它变成一个谜。只有真的被调过才显示，避免噪音。
   */
  const t = useT();
  const effective =
    against && !ok ? ensureTextContrast(value, [against], against, 4.6) : value;
  const adjusted = effective.toLowerCase() !== value.toLowerCase();
  return (
    <label className="flex items-center gap-2">
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(e) => patch({ [field]: e.target.value })}
        className="h-7 w-9 shrink-0 cursor-pointer rounded border border-line bg-transparent"
      />
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-dim">{label}</span>
      <span
        className="num shrink-0 text-[10.5px] text-faint"
        title={adjusted ? `实际生效 ${effective}` : value}
      >
        {value}
      </span>
      {ratio !== null && (
        <span
          className={`num w-11 shrink-0 text-right text-[10.5px] ${
            ok ? "text-ok" : "text-danger"
          }`}
          title={ok ? "WCAG AA ✓" : "低于 AA 4.5:1，保存时会自动调深/调浅"}
        >
          {ratio.toFixed(1)}:1
        </span>
      )}
      {adjusted && (
        <span
          className="shrink-0 rounded bg-warn/15 px-1 text-[10px] text-warn"
          title={`实际生效 ${effective}`}
        >
          {t("settings.editorAdjusted")}
        </span>
      )}
    </label>
  );
}
