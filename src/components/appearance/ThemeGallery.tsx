import { useMemo, useRef, useState } from "react";
import { Download, Link2, Plus, Upload } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../lib/store";
import { useT } from "../../lib/i18n";
import {
  allThemes,
  deriveTheme,
  editableTheme,
  findTheme,
} from "../../lib/theme/presets";
import type { ThemeInput } from "../../lib/theme/tokens";
import { buildShareUrl } from "../../lib/theme/share";
import { Btn, Card, SectionTitle } from "../../ui";
import { ThemeEditor } from "../ThemeEditorPanel";
import { ThemeCard } from "./ThemeCard";

export function ThemeGallery() {
  const t = useT();
  const {
    theme,
    customThemes,
    setTheme,
    upsertTheme,
    deleteTheme,
    importTheme,
    setToast,
  } = useStore(
    useShallow((s) => ({
      theme: s.theme,
      customThemes: s.customThemes,
      setTheme: s.setTheme,
      upsertTheme: s.upsertTheme,
      deleteTheme: s.deleteTheme,
      importTheme: s.importTheme,
      setToast: s.setToast,
    }))
  );
  const [editing, setEditing] = useState<ThemeInput | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const themes = useMemo(() => allThemes(customThemes), [customThemes]);
  const current = findTheme(theme, customThemes);

  const duplicate = () => {
    const base = findTheme(theme, customThemes);
    const id = `custom-${Math.random().toString(36).slice(2, 8)}`;
    setEditing(deriveTheme({ ...base, builtin: false }, `${base.name} copy`, id));
  };

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

  const shareTheme = () => {
    navigator.clipboard
      .writeText(buildShareUrl(current))
      .then(() => setToast(t("settings.themeShareCopied")))
      .catch(() => setToast(t("settings.themeShareFailed")));
  };

  return (
    <>
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
