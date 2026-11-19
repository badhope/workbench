import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../lib/store";
import { useLang, useT } from "../../lib/i18n";
import { LAYOUTS, SHELLS } from "../../lib/layout";
import { Card, Field, SectionTitle } from "../../ui";
import { LayoutWireframe } from "../ThemeEditorPanel";

export function LayoutSection() {
  const t = useT();
  const lang = useLang();
  const { shell, setShell, layout, setLayout } = useStore(
    useShallow((s) => ({
      shell: s.shell,
      setShell: s.setShell,
      layout: s.layout,
      setLayout: s.setLayout,
    }))
  );
  return (
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
      <p className="text-[11px] leading-relaxed text-dim">{t("settings.layoutHint")}</p>

      {/* 版面线框图：选之前就能看出五种编排放得不一样。
              没有它时左卡比右卡矮一截，栅格里就是一片纯空白。 */}
      <div className="mt-3 border-t border-line/60 pt-3">
        <div className="mb-2 text-[10px] font-medium tracking-[0.06em] text-faint">
          {t("settings.layoutPreview")}
        </div>
        <LayoutWireframe id={layout} />
      </div>
    </Card>
  );
}
