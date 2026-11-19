import { useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, RotateCcw } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../lib/store";
import { useLang, useT } from "../../lib/i18n";
import { normalizeOrder, spanOf, widgetOf, type WidgetId } from "../../lib/layout";
import { Btn, Card, SectionTitle } from "../../ui";
import { WidgetSpanSelect } from "./WidgetSpanSelect";

export function WidgetsSection() {
  const t = useT();
  const lang = useLang();
  const {
    widgetOrder,
    widgetHidden,
    setWidgetOrder,
    setWidgetHidden,
    widgetSpans,
    setWidgetSpan,
    resetWidgets,
  } = useStore(
    useShallow((s) => ({
      widgetOrder: s.widgetOrder,
      widgetHidden: s.widgetHidden,
      setWidgetOrder: s.setWidgetOrder,
      setWidgetHidden: s.setWidgetHidden,
      widgetSpans: s.widgetSpans,
      setWidgetSpan: s.setWidgetSpan,
      resetWidgets: s.resetWidgets,
    }))
  );
  const [dragId, setDragId] = useState<WidgetId | null>(null);

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
              <span className="min-w-0 flex-1 truncate text-[12px]">{w.name[lang]}</span>
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
  );
}
