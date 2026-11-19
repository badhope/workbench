import { useT } from "../../lib/i18n";
import { SPAN_OPTIONS, type WidgetId } from "../../lib/layout";

/**
 * 组件宽度选择器。
 *
 * 用下拉而不是拖拽调整：宽度是离散的（4/6/8/12），拖拽会给用户
 * 「能拖到任意宽度」的错觉，而且拖动时没有吸附反馈。四档下拉
 * 一眼能看出「这个组件现在占多宽」。
 */
export function WidgetSpanSelect({
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
