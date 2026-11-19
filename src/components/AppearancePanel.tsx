import { EffectsSection } from "./appearance/EffectsSection";
import { ThemeGallery } from "./appearance/ThemeGallery";
import { LayoutSection } from "./appearance/LayoutSection";
import { WidgetsSection } from "./appearance/WidgetsSection";

/** 外观面板：动效/背景、主题库、版面、组件摆放四块组合。 */
export function AppearancePanel() {
  return (
    <>
      <EffectsSection />
      <ThemeGallery />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <LayoutSection />
        <WidgetsSection />
      </div>
    </>
  );
}
