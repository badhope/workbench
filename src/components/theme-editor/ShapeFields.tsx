import { useT } from "../../lib/i18n";
import {
  clampElevation,
  clampGlow,
  type Density,
  type FontChoice,
  type Material,
  type ThemeInput,
} from "../../lib/theme/tokens";
import { Btn } from "../../ui";

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

/** 形状与排版：圆角 / 网格 / 不透明度滑杆 + 密度、字体、材质三组开关。 */
export function ShapeFields({
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
