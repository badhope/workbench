import { useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  Eye,
  EyeOff,
  GripVertical,
  Link2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { useStore } from "../lib/store";
import { useShallow } from "zustand/react/shallow";
import { useLang, useT } from "../lib/i18n";
import {
  allThemes,
  deriveTheme,
  describeTheme,
  editableTheme,
  findTheme,
  swatchOf,
} from "../lib/theme/presets";
import { mix, type ThemeInput } from "../lib/theme/tokens";
import type { MotionLevel } from "../lib/theme/apply";
import {
  LAYOUTS,
  SHELLS,
  SPAN_OPTIONS,
  normalizeOrder,
  spanOf,
  widgetOf,
  type WidgetId,
} from "../lib/layout";
import { LayoutWireframe, ThemeEditor } from "./ThemeEditorPanel";
import { readableOn } from "../lib/theme/readable";
import { buildShareUrl } from "../lib/theme/share";
import { Btn, Card, Field, SectionTitle } from "../ui";

/** 动效三档（关/标准/满格）。顺序即展示顺序，off 在最前。 */
const MOTIONS: { id: MotionLevel; key: string }[] = [
  { id: "off", key: "settings.motionOff" },
  { id: "standard", key: "settings.motionStandard" },
  { id: "rich", key: "settings.motionRich" },
];

/**
 * 外观面板：主题（含自定义与导入导出）、外壳、概览版面、组件摆放。
 *
 * 拆成独立组件的原因：设置页本来就承担成本、数据、刷新等多块职责，
 * 主题编辑器有它自己的草稿状态（未保存的编辑不能直接作用到界面），
 * 混在设置页里会让那 500 行继续膨胀。
 */
export function AppearancePanel() {
  const t = useT();
  const lang = useLang();
  const {
    theme,
    customThemes,
    setTheme,
    upsertTheme,
    deleteTheme,
    importTheme,
    motion,
    setMotion,
    particles,
    setParticles,
    shell,
    setShell,
    layout,
    setLayout,
    widgetOrder,
    widgetHidden,
    setWidgetOrder,
    setWidgetHidden,
    widgetSpans,
    setWidgetSpan,
    resetWidgets,
    setToast,
  } = useStore(
    useShallow((s) => ({
      theme: s.theme,
      customThemes: s.customThemes,
      setTheme: s.setTheme,
      upsertTheme: s.upsertTheme,
      deleteTheme: s.deleteTheme,
      importTheme: s.importTheme,
      motion: s.motion,
      setMotion: s.setMotion,
      particles: s.particles,
      setParticles: s.setParticles,
      shell: s.shell,
      setShell: s.setShell,
      layout: s.layout,
      setLayout: s.setLayout,
      widgetOrder: s.widgetOrder,
      widgetHidden: s.widgetHidden,
      setWidgetOrder: s.setWidgetOrder,
      setWidgetHidden: s.setWidgetHidden,
      widgetSpans: s.widgetSpans,
      setWidgetSpan: s.setWidgetSpan,
      resetWidgets: s.resetWidgets,
      setToast: s.setToast,
    }))
  );

  const [editing, setEditing] = useState<ThemeInput | null>(null);
  const [dragId, setDragId] = useState<WidgetId | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const themes = useMemo(() => allThemes(customThemes), [customThemes]);
  const current = findTheme(theme, customThemes);

  const duplicate = () => {
    const base = findTheme(theme, customThemes);
    const id = `custom-${Math.random().toString(36).slice(2, 8)}`;
    const copy = deriveTheme({ ...base, builtin: false }, `${base.name} copy`, id);
    setEditing(copy);
  };

  /** 编辑内置主题 = 自动复制一份再改；编辑自定义主题 = 原地改。 */
  const edit = (source: ThemeInput) => {
    const { theme: editable, copied } = editableTheme(
      source,
      () => `custom-${Math.random().toString(36).slice(2, 8)}`
    );
    if (copied) setToast(t("settings.themeCopied"));
    setEditing(editable);
  };

  const exportTheme = () => {
    const data = JSON.stringify(current, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workbench-theme-${current.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setToast(t("settings.themeExported"));
  };

  const importFromFile = async (file: File) => {
    const res = importTheme(await file.text());
    setToast(res.ok ? t("settings.themeImported") : res.error || "");
  };

  /** 分享链接：主题压进 URL hash，对方打开即导入（与 JSON 导入同一套校验）。 */
  const shareTheme = () => {
    navigator.clipboard
      .writeText(buildShareUrl(current))
      .then(() => setToast(t("settings.themeShareCopied")))
      .catch(() => setToast(t("settings.themeShareFailed")));
  };

  const move = (id: WidgetId, dir: -1 | 1) => {
    const order = normalizeOrder(widgetOrder);
    const idx = order.indexOf(id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= order.length) return;
    [order[idx], order[next]] = [order[next], order[idx]];
    setWidgetOrder(order);
  };

  const toggleWidget = (id: WidgetId) => {
    setWidgetHidden(
      widgetHidden.includes(id)
        ? widgetHidden.filter((x) => x !== id)
        : [...widgetHidden, id]
    );
  };

  const dropOn = (target: WidgetId) => {
    if (!dragId || dragId === target) return;
    const order = normalizeOrder(widgetOrder);
    const from = order.indexOf(dragId);
    const to = order.indexOf(target);
    if (from < 0 || to < 0) return;
    order.splice(from, 1);
    order.splice(to, 0, dragId);
    setWidgetOrder(order);
    setDragId(null);
  };

  return (
    <>
      <Card>
        <SectionTitle>{t("settings.motionSection")}</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {MOTIONS.map((m) => (
            <button
              key={m.id}
              type="button"
              data-motion-level={m.id}
              aria-pressed={motion === m.id}
              onClick={() => setMotion(m.id)}
              className={`t-btn border px-2.5 py-1 text-[11.5px] font-medium ${
                motion === m.id
                  ? "border-accent bg-accent text-[var(--color-on-accent)]"
                  : "border-line bg-panel2/70 text-dim hover:text-text"
              }`}
            >
              {t(m.key)}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-dim">
          {t("settings.motionHint")}
        </p>
      </Card>

      <Card>
        <SectionTitle>{t("settings.particlesSection")}</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: true, key: "settings.particlesOn" },
              { id: false, key: "settings.particlesOff" },
            ] as const
          ).map((o) => (
            <button
              key={String(o.id)}
              type="button"
              data-particles={String(o.id)}
              aria-pressed={particles === o.id}
              onClick={() => setParticles(o.id)}
              className={`t-btn border px-2.5 py-1 text-[11.5px] font-medium ${
                particles === o.id
                  ? "border-accent bg-accent text-[var(--color-on-accent)]"
                  : "border-line bg-panel2/70 text-dim hover:text-text"
              }`}
            >
              {t(o.key)}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-dim">
          {t("settings.particlesHint")}
        </p>
      </Card>

      <Card>
        <SectionTitle
          extra={
            <div className="flex items-center gap-1.5">
              <Btn
                className="!px-2 !py-1 !text-[11px]"
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={12} /> {t("settings.themeImport")}
              </Btn>
              <Btn className="!px-2 !py-1 !text-[11px]" onClick={exportTheme}>
                <Download size={12} /> {t("settings.themeExport")}
              </Btn>
              <Btn
                className="!px-2 !py-1 !text-[11px]"
                onClick={shareTheme}
                title={t("settings.themeShareCopied")}
              >
                <Link2 size={12} /> {t("settings.themeShare")}
              </Btn>
              <Btn
                variant="primary"
                className="!px-2 !py-1 !text-[11px]"
                onClick={duplicate}
              >
                <Plus size={12} /> {t("settings.themeNew")}
              </Btn>
            </div>
          }
        >
          {t("settings.themeSection")}
        </SectionTitle>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {themes.map((th) => (
            <ThemeCard
              key={th.id}
              theme={th}
              active={theme === th.id}
              onPick={() => setTheme(th.id)}
              onEdit={() => edit(th)}
              onCopy={() => {
                const id = `custom-${Math.random().toString(36).slice(2, 8)}`;
                setEditing(deriveTheme({ ...th, builtin: false }, `${th.name} copy`, id));
              }}
              onDelete={() => {
                deleteTheme(th.id);
                setToast(t("settings.themeDeleted"));
              }}
            />
          ))}
        </div>

        <p className="mt-2.5 text-[11px] leading-relaxed text-dim">
          {t("settings.themeHint")}
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          aria-label={t("settings.themeImport")}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFromFile(f);
            e.target.value = "";
          }}
        />
      </Card>

      {/* items-start：两张卡各自按内容定高，否则栅格会把矮的那张拉伸到与高的一致 */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <Card>
          <SectionTitle>{t("settings.layoutSection")}</SectionTitle>

          <Field label={t("settings.layoutShell")}>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
              {SHELLS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  data-shell={s.id}
                  aria-pressed={shell === s.id}
                  onClick={() => setShell(s.id)}
                  className={`rounded-[var(--radius-btn)] border px-2.5 py-2 text-left transition-colors ${
                    shell === s.id
                      ? "border-accent bg-accent/8"
                      : "border-line hover:border-accent/40"
                  }`}
                >
                  <div className="text-[12px] font-medium">{s.name[lang]}</div>
                  <div className="mt-0.5 text-[10px] leading-snug text-faint">
                    {s.hint[lang]}
                  </div>
                </button>
              ))}
            </div>
          </Field>

          <Field label={t("settings.layoutOverview")}>
            <div className="flex flex-wrap gap-1.5">
              {LAYOUTS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  data-layout={l.id}
                  aria-pressed={layout === l.id}
                  title={l.hint[lang]}
                  onClick={() => setLayout(l.id)}
                  className={`t-btn border px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                    layout === l.id
                      ? "border-accent bg-accent text-[var(--color-bg)]"
                      : "border-line bg-panel2/70 text-dim hover:text-text"
                  }`}
                >
                  {l.name[lang]}
                </button>
              ))}
            </div>
          </Field>
          <p className="text-[11px] leading-relaxed text-dim">
            {t("settings.layoutHint")}
          </p>

          {/* 版面线框图：选之前就能看出五种编排放得不一样。
              没有它时左卡比右卡矮一截，栅格里就是一片纯空白。 */}
          <div className="mt-3 border-t border-line/60 pt-3">
            <div className="mb-2 text-[10px] font-medium tracking-[0.06em] text-faint">
              {t("settings.layoutPreview")}
            </div>
            <LayoutWireframe id={layout} />
          </div>
        </Card>

        <Card>
          <SectionTitle
            extra={
              <Btn className="!px-2 !py-1 !text-[11px]" onClick={resetWidgets}>
                <RotateCcw size={11} /> {t("settings.widgetsReset")}
              </Btn>
            }
          >
            {t("settings.widgetsSection")}
          </SectionTitle>

          <ul className="flex flex-col gap-1">
            {normalizeOrder(widgetOrder).map((id, i, arr) => {
              const w = widgetOf(id);
              const hidden = widgetHidden.includes(id);
              return (
                <li
                  key={id}
                  draggable
                  onDragStart={() => setDragId(id)}
                  onDragEnd={() => setDragId(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => dropOn(id)}
                  className={`flex items-center gap-1.5 rounded-[var(--radius-btn)] border px-2 py-1.5 transition-colors ${
                    dragId === id
                      ? "border-accent bg-accent/8"
                      : "border-line/70 bg-panel2/40"
                  } ${hidden ? "opacity-45" : ""}`}
                >
                  <GripVertical size={12} className="shrink-0 cursor-grab text-faint" />
                  <span className="min-w-0 flex-1 truncate text-[12px]">
                    {w.name[lang]}
                  </span>
                  <WidgetSpanSelect
                    id={id}
                    value={spanOf(id, widgetSpans)}
                    onPick={(span) => setWidgetSpan(id, span)}
                  />
                  <button
                    type="button"
                    className="rounded p-0.5 text-faint hover:text-text disabled:opacity-30"
                    title={t("settings.widgetsUp")}
                    aria-label={t("settings.widgetsUp")}
                    disabled={i === 0}
                    onClick={() => move(id, -1)}
                  >
                    <ArrowUp size={12} />
                  </button>
                  <button
                    type="button"
                    className="rounded p-0.5 text-faint hover:text-text disabled:opacity-30"
                    title={t("settings.widgetsDown")}
                    aria-label={t("settings.widgetsDown")}
                    disabled={i === arr.length - 1}
                    onClick={() => move(id, 1)}
                  >
                    <ArrowDown size={12} />
                  </button>
                  <button
                    type="button"
                    className="rounded p-0.5 text-faint hover:text-text"
                    title={hidden ? t("settings.widgetsShow") : t("settings.widgetsHide")}
                    aria-label={
                      hidden ? t("settings.widgetsShow") : t("settings.widgetsHide")
                    }
                    onClick={() => toggleWidget(id)}
                  >
                    {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-dim">
            {t("settings.widgetsHint")}
          </p>
        </Card>
      </div>

      <ThemeEditor
        draft={editing}
        onCancel={() => setEditing(null)}
        onSave={(next) => {
          upsertTheme(next);
          setEditing(null);
          setToast(t("settings.themeSaved"));
        }}
      />
    </>
  );
}

/**
 * 一张主题卡：迷你预览 + 名称 + 悬停时的编辑/复制/删除。
 *
 * 抽出来的原因：AppearancePanel 原本 425 行，其中这个卡片的内联 JSX
 * 就占 120+ 行（三套按钮 + 预览结构），拆开后父组件只剩编排。
 */
function ThemeCard({
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

/**
 * 组件宽度选择器。
 *
 * 用下拉而不是拖拽调整：宽度是离散的（4/6/8/12），拖拽会给用户
 * 「能拖到任意宽度」的错觉，而且拖动时没有吸附反馈。四档下拉
 * 一眼能看出「这个组件现在占多宽」。
 */
function WidgetSpanSelect({
  id,
  value,
  onPick,
}: {
  id: WidgetId;
  value: number;
  onPick: (span: number) => void;
}) {
  const t = useT();
  return (
    <select
      aria-label={t("settings.widgetsSpan")}
      title={t("settings.widgetsSpan")}
      data-widget-span={id}
      value={String(value)}
      onChange={(e) => onPick(Number(e.target.value))}
      className="shrink-0 rounded-[3px] border border-line bg-panel2 px-1 py-0.5 text-[10px] text-dim outline-none hover:text-text"
    >
      {SPAN_OPTIONS.map((s) => (
        <option key={s} value={s}>
          {s}/12
        </option>
      ))}
    </select>
  );
}
