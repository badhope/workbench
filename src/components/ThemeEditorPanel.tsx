import { useState } from "react";
import { useT } from "../lib/i18n";
import {
  buildTheme,
  clampElevation,
  clampGlow,
  contrastRatio,
  deriveAccent2,
  ensureTextContrast,
  type Density,
  type FontChoice,
  type Material,
  type ThemeInput,
} from "../lib/theme/tokens";
import { Btn, Field, Modal, inputCls } from "../ui";

// ── 主题编辑器 ─────────────────────────────────────────────

/**
 * 版面线框图：用几块灰阶矩形表达「组件怎么摆」。
 *
 * 为什么值得画：各版面在文字描述上都是「重排概览」，用户点之前
 * 分不出差别；而线框能在一眼之内说明 bento 是大小格、ledger 是通栏、
 * orbit 是绕环、dense 是两列、zen 是一条主图、timeline 是竖轨、board 是三列。
 */
export function LayoutWireframe({ id }: { id: string }) {
  const rows: Record<string, React.ReactNode> = {
    bento: (
      <div className="flex h-full flex-col gap-1">
        <div className="flex gap-1">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-3 flex-1 rounded-[2px] bg-current opacity-70" />
          ))}
        </div>
        <div className="flex flex-1 gap-1">
          <div className="w-2/3 rounded-[2px] bg-current opacity-45" />
          <div className="flex-1 rounded-[2px] bg-current opacity-55" />
        </div>
        <div className="flex h-3 gap-1">
          <div className="flex-1 rounded-[2px] bg-current opacity-35" />
          <div className="flex-1 rounded-[2px] bg-current opacity-35" />
        </div>
      </div>
    ),
    ledger: (
      <div className="flex h-full flex-col gap-1">
        {[70, 55, 62, 48].map((w, i) => (
          <div
            key={i}
            className="h-3 rounded-[2px] bg-current opacity-50"
            style={{ width: `${w}%` }}
          />
        ))}
      </div>
    ),
    orbit: (
      <div className="relative h-full">
        <div className="absolute left-1/2 top-1/2 h-3/4 w-3/4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-current opacity-30" />
        <div className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current opacity-75" />
        {[0, 60, 120, 180, 240, 300].map((deg) => (
          <div
            key={deg}
            className="absolute h-2.5 w-2.5 rounded-[2px] bg-current opacity-50"
            style={{
              left: `calc(50% + ${Math.cos((deg * Math.PI) / 180) * 38}% - 5px)`,
              top: `calc(50% + ${Math.sin((deg * Math.PI) / 180) * 34}% - 5px)`,
            }}
          />
        ))}
      </div>
    ),
    dense: (
      <div className="grid h-full grid-cols-2 gap-1">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-[2px] bg-current opacity-45" />
        ))}
      </div>
    ),
    zen: (
      <div className="flex h-full flex-col gap-1 items-center justify-center">
        <div className="h-3 w-2/3 rounded-[2px] bg-current opacity-70" />
        <div className="h-8 w-full rounded-[2px] bg-current opacity-40" />
      </div>
    ),
    timeline: (
      <div className="relative h-full pl-3">
        <div className="absolute bottom-0.5 left-[2px] top-0.5 w-px bg-current opacity-30" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="relative mb-1 flex items-center">
            <span className="absolute -left-[6.5px] h-[9px] w-[9px] rounded-full bg-current opacity-70" />
            <div
              className="h-3 rounded-[2px] bg-current opacity-45"
              style={{ width: ["100%", "82%", "64%"][i] }}
            />
          </div>
        ))}
      </div>
    ),
    board: (
      <div className="grid h-full grid-cols-3 gap-1.5">
        {[3, 2, 2].map((n, c) => (
          <div key={c} className="flex flex-col gap-1 border-t border-current/50 pt-1">
            {Array.from({ length: n }).map((_, i) => (
              <div key={i} className="h-2.5 rounded-[2px] bg-current opacity-45" />
            ))}
          </div>
        ))}
      </div>
    ),
  };
  return (
    <div className="h-20 rounded-[var(--radius-btn)] border border-line/70 bg-panel2/40 p-2 text-text">
      {rows[id] ?? rows.bento}
    </div>
  );
}

const DENSITIES: { id: Density; key: string }[] = [
  { id: "compact", key: "settings.densityCompact" },
  { id: "cozy", key: "settings.densityCozy" },
  { id: "roomy", key: "settings.densityRoomy" },
];

const FONTS: { id: FontChoice; key: string }[] = [
  { id: "sans", key: "settings.fontSans" },
  { id: "serif", key: "settings.fontSerif" },
  { id: "mono", key: "settings.fontMono" },
];

const MATERIALS: { id: Material; key: string }[] = [
  { id: "flat", key: "settings.materialFlat" },
  { id: "line", key: "settings.materialLine" },
  { id: "glass", key: "settings.materialGlass" },
];

const ELEVATIONS = [0, 1, 2, 3] as const;

export function ThemeEditor({
  draft,
  onSave,
  onCancel,
}: {
  draft: ThemeInput | null;
  onSave: (t: ThemeInput) => void;
  onCancel: () => void;
}) {
  const t = useT();
  // 草稿状态放在这一层：Modal 的 footer 按钮和主体编辑的是同一份数据。
  // 用 draft.id 作为 key 让每次打开重置草稿——比 effect 同步更简单，
  // 也避免了「编辑到一半被外部 props 覆盖」这类经典问题。
  const [local, setLocal] = useState<ThemeInput | null>(draft);
  const [editingId, setEditingId] = useState<string | null>(draft?.id ?? null);

  if ((draft?.id ?? null) !== editingId) {
    setEditingId(draft?.id ?? null);
    setLocal(draft);
  }

  const patch = (p: Partial<ThemeInput>) => setLocal((d) => (d ? { ...d, ...p } : d));

  return (
    <Modal
      open={!!draft}
      title={t("settings.editorTitle")}
      onClose={onCancel}
      wide
      footer={
        <>
          <Btn onClick={onCancel}>{t("settings.editorCancel")}</Btn>
          <Btn variant="primary" onClick={() => local && onSave(local)}>
            {t("settings.editorSave")}
          </Btn>
        </>
      }
    >
      {local && <ThemeEditorBody draft={local} onPatch={patch} />}
    </Modal>
  );
}

/**
 * 颜色编辑区。
 *
 * 拆成独立组件的原因：整个编辑器 228 行，颜色/形状/预览三块互不依赖，
 * 拆开后每块都能单独看、单独测（也才过得了"单函数≤120 行"的门禁）。
 */
function ColorFields({
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

/** 形状与排版：圆角 / 网格 / 不透明度滑杆 + 密度、字体、材质三组开关。 */
function ShapeFields({
  local,
  patch,
}: {
  local: ThemeInput;
  patch: (p: Partial<ThemeInput>) => void;
}) {
  const t = useT();
  const slider = (
    key: "radiusCard" | "radiusBtn",
    label: string,
    max: number,
    suffix = "px"
  ) => (
    <label className="mb-2 block text-[11px] text-dim">
      {label} — {local[key]}
      {suffix}
      <input
        type="range"
        min={0}
        max={max}
        value={local[key]}
        onChange={(e) => patch({ [key]: Number(e.target.value) } as Partial<ThemeInput>)}
        className="mt-1 w-full"
      />
    </label>
  );

  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium text-dim">
        {t("settings.editorShape")}
      </div>
      {slider("radiusCard", t("settings.editorRadius"), 24)}
      {slider("radiusBtn", t("settings.editorRadiusBtn"), 20)}
      <label className="mb-2 block text-[11px] text-dim">
        {t("settings.editorGrid")} — {Math.round(local.grid * 100)}%
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(local.grid * 100)}
          onChange={(e) => patch({ grid: Number(e.target.value) / 100 })}
          className="mt-1 w-full"
        />
      </label>
      <label className="mb-2 block text-[11px] text-dim">
        {t("settings.editorOpacity")} — {Math.round(local.panelOpacity * 100)}%
        <input
          type="range"
          min={20}
          max={100}
          value={Math.round(local.panelOpacity * 100)}
          onChange={(e) => patch({ panelOpacity: Number(e.target.value) / 100 })}
          className="mt-1 w-full"
        />
      </label>
      <label className="mb-2 block text-[11px] text-dim">
        {t("settings.editorTextScale")} — {Math.round((local.textScale ?? 1) * 100)}%
        <input
          type="range"
          min={85}
          max={120}
          value={Math.round((local.textScale ?? 1) * 100)}
          onChange={(e) => patch({ textScale: Number(e.target.value) / 100 })}
          className="mt-1 w-full"
        />
      </label>
      {/* 氛围光：0 = 关。滑杆显示的是 0-100 原始参数，求解（clamp/默认派生）
          在 buildTheme 里做，这里不重复实现，避免两处规则漂移。 */}
      <label className="mb-2 block text-[11px] text-dim">
        {t("settings.editorGlow")} — {clampGlow(local.glow, local.material)}
        <input
          type="range"
          min={0}
          max={100}
          value={clampGlow(local.glow, local.material)}
          onChange={(e) => patch({ glow: Number(e.target.value) })}
          className="mt-1 w-full"
        />
      </label>
      <div className="mt-2">
        <div className="mb-1 text-[10px] tracking-[0.06em] text-faint">
          {t("settings.editorElevation")}
        </div>
        <div className="flex flex-wrap gap-1">
          {ELEVATIONS.map((lv) => (
            <Btn
              key={lv}
              variant={
                clampElevation(local.elevation, local.material) === lv
                  ? "primary"
                  : "ghost"
              }
              className="!px-2 !py-0.5 !text-[11px]"
              onClick={() => patch({ elevation: lv })}
            >
              {t(`settings.editorElevation${lv}`)}
            </Btn>
          ))}
        </div>
      </div>
      {(
        [
          [DENSITIES, "density", "settings.editorDensity"],
          [FONTS, "font", "settings.editorFont"],
          [MATERIALS, "material", "settings.editorMaterial"],
        ] as const
      ).map(([options, field, labelKey]) => (
        <div key={field} className="mt-2">
          <div className="mb-1 text-[10px] tracking-[0.06em] text-faint">
            {t(labelKey)}
          </div>
          <div className="flex flex-wrap gap-1">
            {options.map((o) => (
              <Btn
                key={o.id}
                variant={local[field] === o.id ? "primary" : "ghost"}
                className="!px-2 !py-0.5 !text-[11px]"
                onClick={() => patch({ [field]: o.id } as Partial<ThemeInput>)}
              >
                {t(o.key)}
              </Btn>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 编辑器主体。所有改动都先写进本地草稿（受控），
 * 只有「保存并应用」才落到 store —— 用户在调色时不该被半成品主题闪屏。
 */
function ThemeEditorBody({
  draft: local,
  onPatch: patch,
}: {
  draft: ThemeInput;
  onPatch: (p: Partial<ThemeInput>) => void;
}) {
  const t = useT();
  const tokens = buildTheme(local);

  return (
    <div className="flex flex-col gap-4">
      <Field label={t("settings.editorName")}>
        <input
          className={inputCls}
          value={local.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ColorFields local={local} patch={patch} />
        <ShapeFields local={local} patch={patch} />
      </div>

      <div
        className="overflow-hidden rounded-[var(--radius-card)] border p-3"
        style={{
          background: local.bg,
          borderColor: tokens.vars["--color-line"],
          color: local.text,
          fontFamily: tokens.vars["--font-sans"],
        }}
      >
        <div
          className="mb-2 text-[10px] tracking-[0.1em]"
          style={{ color: tokens.vars["--color-faint"] }}
        >
          PREVIEW
        </div>
        <div className="flex gap-2">
          <div
            className="flex-1 p-2"
            style={{
              background: local.panel,
              borderRadius: local.radiusCard,
              border: `1px solid ${tokens.vars["--color-line"]}`,
            }}
          >
            <div className="text-[10.5px]" style={{ color: tokens.vars["--color-dim"] }}>
              {t("overview.statRunningProcs")}
            </div>
            <div
              className="num mt-1 text-[20px] font-semibold"
              style={{ color: local.accent, fontFamily: tokens.vars["--font-mono"] }}
            >
              42
            </div>
            {/* 渐变数字预览：与 .grad-accent 同一 token，编辑器里改什么立即看到 */}
            <div
              className="num mt-1 text-[20px] font-semibold"
              style={{
                backgroundImage: tokens.vars["--gradient-accent"],
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                fontFamily: tokens.vars["--font-mono"],
              }}
            >
              42
            </div>
          </div>
          <div
            className="flex-1 p-2"
            style={{
              background: local.panel,
              borderRadius: local.radiusCard,
              border: `1px solid ${tokens.vars["--color-line"]}`,
            }}
          >
            <div className="text-[10.5px]" style={{ color: tokens.vars["--color-dim"] }}>
              {t("overview.statDevServers")}
            </div>
            <div
              className="num mt-1 text-[20px] font-semibold"
              style={{
                color: tokens.vars["--color-ok"],
                fontFamily: tokens.vars["--font-mono"],
              }}
            >
              3
            </div>
          </div>
        </div>
        <div className="mt-2 flex gap-1.5">
          <span
            className="px-2 py-0.5 text-[10.5px]"
            style={{
              backgroundImage: tokens.vars["--gradient-accent"],
              backgroundColor: local.accent,
              color: tokens.vars["--color-on-accent"],
              borderRadius: local.radiusBtn,
            }}
          >
            Primary
          </span>
          <span
            className="px-2 py-0.5 text-[10.5px]"
            style={{
              border: `1px solid ${tokens.vars["--color-line"]}`,
              color: local.text,
              borderRadius: local.radiusBtn,
            }}
          >
            Secondary
          </span>
        </div>
      </div>
    </div>
  );
}
