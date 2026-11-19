import { useState } from "react";
import { useT } from "../lib/i18n";
import { buildTheme, type ThemeInput } from "../lib/theme/tokens";
import { Btn, Field, Modal, inputCls } from "../ui";
import { ColorFields } from "./theme-editor/ColorFields";
import { ShapeFields } from "./theme-editor/ShapeFields";

export { LayoutWireframe } from "./theme-editor/LayoutWireframe";

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
