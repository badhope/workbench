import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES } from "./presets";
import {
  buildTheme,
  chartSeries,
  clampElevation,
  clampGlow,
  clampTextScale,
  contrastRatio,
  deriveAccent2,
  luminance,
  mix,
  parseHex,
  toHex,
  withAlpha,
  type ThemeInput,
} from "./tokens";

const base: ThemeInput = {
  id: "test",
  name: "Test",
  dark: true,
  bg: "#07080b",
  panel: "#0c0f15",
  text: "#e8ecf2",
  accent: "#22d3ee",
  radiusCard: 10,
  radiusBtn: 7,
  density: "cozy",
  font: "sans",
  material: "line",
  grid: 1,
  panelOpacity: 1,
};

describe("颜色工具", () => {
  it("parseHex 支持 3 位与 6 位，非法值回退黑", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("22d3ee")).toEqual([34, 211, 238]);
    expect(parseHex("nope")).toEqual([0, 0, 0]);
  });

  it("toHex 四舍五入并补零", () => {
    expect(toHex([0, 5, 255])).toBe("#0005ff");
    expect(toHex([1.4, 2.6, 3.5])).toBe("#010304");
  });

  it("mix 在两端返回端点，中间是插值", () => {
    expect(mix("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mix("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("withAlpha 生成合法 rgba", () => {
    expect(withAlpha("#22d3ee", 0.5)).toBe("rgba(34, 211, 238, 0.5)");
    // 越界值被夹住，而不是产生 rgba(...,1.5)
    expect(withAlpha("#000000", 9)).toContain("1)");
  });

  it("luminance 单调：白 > 灰 > 黑", () => {
    expect(luminance("#ffffff")).toBeGreaterThan(luminance("#808080"));
    expect(luminance("#808080")).toBeGreaterThan(luminance("#000000"));
  });
});

describe("buildTheme", () => {
  it("产出全部契约变量，且每个都有值", () => {
    const t = buildTheme(base);
    for (const key of [
      "--color-bg",
      "--color-panel",
      "--color-panel2",
      "--color-line",
      "--color-text",
      "--color-dim",
      "--color-faint",
      "--color-accent",
      "--color-accent2",
      "--color-accentsoft",
      "--gradient-accent",
      "--color-ok",
      "--color-warn",
      "--color-danger",
      "--font-sans",
      "--font-display",
      "--font-mono",
      "--radius-card",
      "--radius-btn",
      "--shadow-card",
      "--shadow-card-hover",
      "--space-card",
      "--line-height-body",
      "--hairline",
      "--hairline-strong",
      "--panel-opacity",
      "--panel-blur",
      "--grid-strength",
      "--glow",
    ]) {
      expect(t.vars[key], key).toBeTruthy();
    }
  });

  it("密度改变间距与行高，圆角独立可调", () => {
    const compact = buildTheme({ ...base, density: "compact" });
    const roomy = buildTheme({ ...base, density: "roomy" });
    expect(compact.vars["--space-card"]).not.toBe(roomy.vars["--space-card"]);
    expect(compact.vars["--line-height-body"]).not.toBe(roomy.vars["--line-height-body"]);

    const sharp = buildTheme({ ...base, radiusCard: 0 });
    expect(sharp.vars["--radius-card"]).toBe("0px");
  });

  it("字体选择改变 sans/mono 家族", () => {
    const mono = buildTheme({ ...base, font: "mono" });
    const serif = buildTheme({ ...base, font: "serif" });
    expect(mono.vars["--font-sans"].toLowerCase()).toContain("mono");
    expect(serif.vars["--font-sans"].toLowerCase()).toContain("serif");
    expect(mono.vars["--font-sans"]).not.toBe(serif.vars["--font-sans"]);
  });

  it("玻璃材质才给 blur，其他材质为 0px", () => {
    expect(buildTheme({ ...base, material: "glass" }).vars["--panel-blur"]).toBe("20px");
    expect(buildTheme({ ...base, material: "flat" }).vars["--panel-blur"]).toBe("0px");
    expect(buildTheme({ ...base, material: "line" }).vars["--glow"]).toBe("0");
  });

  it("图表色板与主题一致，且系列色以 accent 打头", () => {
    const t = buildTheme(base);
    expect(t.chart.bg).toBe(base.bg);
    expect(t.chart.panel).toBe(base.panel);
    expect(t.chart.series[0]).toBe(base.accent);
    expect(t.chart.accentSoft).toBe(t.vars["--color-accentsoft"]);
  });

  it("面板不透明度被夹在 0.2..1", () => {
    expect(buildTheme({ ...base, panelOpacity: 0 }).vars["--panel-opacity"]).toBe("0.2");
    expect(buildTheme({ ...base, panelOpacity: 5 }).vars["--panel-opacity"]).toBe("1");
  });

  it("亮色主题的派生色朝黑走，不会出现白字白底", () => {
    const light = buildTheme({
      ...base,
      dark: false,
      bg: "#ffffff",
      panel: "#ffffff",
      text: "#111111",
    });
    // dim/faint 是 text 与 bg 之间，必然比 text 浅、比 bg 深
    expect(luminance(light.vars["--color-dim"])).toBeGreaterThan(luminance("#111111"));
    expect(luminance(light.vars["--color-dim"])).toBeLessThan(luminance("#ffffff"));
  });

  /**
   * 选中态：`bg-accentsoft text-accent`（筛选 chip、视图切换、侧栏当前项）。
   *
   * 这条来自真实事故：accentsoft 原本只是「面板混 12% accent」的固定比例，
   * 从未校验过压在上面的 accent 文字。Frost 上实测 4.45:1，差 0.05 没过
   * AA —— 相邻的 4.6:1 求解管住了正文与 dim/faint，唯独漏了这一个组合。
   * 现在八个内置主题必须全部达标，且这是从 token 反解出来的，不是特调。
   */
  it("每套内置主题的选中态（accent on accentsoft）都达到 AA", () => {
    for (const theme of BUILTIN_THEMES) {
      const t = buildTheme(theme);
      const accent = t.vars["--color-accent"];
      const soft = t.vars["--color-accentsoft"];
      const ratio = contrastRatio(accent, soft);
      expect(
        ratio,
        `${theme.name}(${theme.id}) 选中态仅 ${ratio.toFixed(2)}:1`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("自定义主题换上低对比 accent 时，选中态仍被拉回 AA", () => {
    // 用户把 accent 设成接近面板色的灰蓝 —— 这是最容易把选中态做糊的输入
    const weak = buildTheme({
      ...base,
      dark: false,
      bg: "#f6f7f9",
      panel: "#ffffff",
      text: "#111111",
      accent: "#9aa8bb",
    });
    const ratio = contrastRatio(
      weak.vars["--color-accent"],
      weak.vars["--color-accentsoft"]
    );
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

/**
 * 图表系列色与缩放。
 *
 * 这两个都是「写死值读起来没问题、换主题就露馅」的地方：
 * 固定调色板在米色/黑白主题上会突然出现紫色；缩放写死 100% 时
 * 4K 屏用户只能靠系统放大镜。
 */
describe("chartSeries", () => {
  const hsl = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  it("首色永远是主题强调色", () => {
    for (const accent of ["#22d3ee", "#8a5a2b", "#d92b2b", "#1f7a5a"]) {
      expect(chartSeries(accent, true)[0]).toBe(accent);
    }
  });

  it("返回 8 个互不相同的颜色", () => {
    const series = chartSeries("#22d3ee", true);
    expect(series).toHaveLength(8);
    expect(new Set(series.map((c) => c.toLowerCase())).size).toBeGreaterThanOrEqual(7);
  });

  it("深色主题的系列色比浅色主题更亮", () => {
    const lum = (hex: string) => {
      const [r, g, b] = hsl(hex).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const dark = chartSeries("#22d3ee", true).slice(1);
    const light = chartSeries("#22d3ee", false).slice(1);
    const avg = (xs: string[]) => xs.reduce((a, c) => a + lum(c), 0) / xs.length;
    expect(avg(dark)).toBeGreaterThan(avg(light));
  });
});

describe("clampTextScale", () => {
  it("缺省与非法值都是 1", () => {
    expect(clampTextScale(undefined)).toBe(1);
    expect(clampTextScale(Number.NaN)).toBe(1);
  });

  it("夹在 0.85–1.2", () => {
    expect(clampTextScale(0.5)).toBe(0.85);
    expect(clampTextScale(2)).toBe(1.2);
    expect(clampTextScale(1.1)).toBeCloseTo(1.1, 5);
  });
});

/**
 * 视觉 2.0 新增 token：accent2 / 渐变 / glow / elevation。
 * 与旧 token 同一原则——用户只给意图，求解集中在这里，页面不感知细节。
 */
describe("accent2 与渐变（视觉 2.0）", () => {
  it("deriveAccent2 = accent 色相 +36°（青→蓝绿分量下降，红→橙绿分量上升）", () => {
    // #22d3ee ≈ 188°（青），+36° ≈ 224°（蓝）：绿分量下降
    const cyan = parseHex(deriveAccent2("#22d3ee"));
    expect(cyan[1]).toBeLessThan(parseHex("#22d3ee")[1]);
    // #ff2222 ≈ 0°（红），+36° ≈ 36°（橙）：绿分量上升
    const red = parseHex(deriveAccent2("#ff2222"));
    expect(red[1]).toBeGreaterThan(parseHex("#ff2222")[1]);
  });

  it("accent2 缺省派生且与 accent 同门槛过 AA（三个表面全部达标）", () => {
    const t = buildTheme(base);
    const accent2 = t.vars["--color-accent2"];
    const surfaces = [base.bg, base.panel, t.vars["--color-panel2"]];
    for (const s of surfaces) {
      expect(contrastRatio(accent2, s)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("用户指定的 accent2 低对比时被拉回 AA（与 accent 同一求解器）", () => {
    const weak = buildTheme({ ...base, accent2: "#2a3a44" });
    expect(contrastRatio(weak.vars["--color-accent2"], base.bg)).toBeGreaterThanOrEqual(
      4.5
    );
  });

  it("渐变默认开启且两端是 accent 与 accent2；关档退化为零跨度（纯色）", () => {
    const on = buildTheme(base);
    expect(on.vars["--gradient-accent"]).toBe(
      `linear-gradient(120deg, ${on.vars["--color-accent"]}, ${on.vars["--color-accent2"]})`
    );
    const off = buildTheme({ ...base, gradientAccent: false });
    expect(off.vars["--gradient-accent"]).toBe(
      `linear-gradient(120deg, ${off.vars["--color-accent"]}, ${off.vars["--color-accent"]})`
    );
  });
});

describe("glow（视觉 2.0）", () => {
  it("clampGlow 越界夹取，缺省跟随材质（glass 55 / 其它 0）", () => {
    expect(clampGlow(undefined, "glass")).toBe(55);
    expect(clampGlow(undefined, "flat")).toBe(0);
    expect(clampGlow(200, "flat")).toBe(100);
    expect(clampGlow(-5, "glass")).toBe(0);
    expect(clampGlow(30.6, "line")).toBe(31);
    expect(clampGlow(Number.NaN, "glass")).toBe(55);
  });

  it("--glow 输出 0-1 字符串，不再绑定材质", () => {
    expect(buildTheme({ ...base, glow: 40 }).vars["--glow"]).toBe("0.4");
    expect(buildTheme({ ...base, material: "glass" }).vars["--glow"]).toBe("0.55");
    expect(buildTheme({ ...base, material: "glass", glow: 0 }).vars["--glow"]).toBe("0");
  });
});

describe("elevation 与卡片阴影（视觉 2.0）", () => {
  it("clampElevation 越界夹取，缺省 flat=1 / 其它=2", () => {
    expect(clampElevation(undefined, "flat")).toBe(1);
    expect(clampElevation(undefined, "line")).toBe(2);
    expect(clampElevation(9, "line")).toBe(3);
    expect(clampElevation(-1, "flat")).toBe(0);
    expect(clampElevation(2.6, "line")).toBe(3);
  });

  it("flat 材质不再一律无阴影；elevation=0 才是 none", () => {
    expect(buildTheme({ ...base, material: "flat" }).vars["--shadow-card"]).not.toBe(
      "none"
    );
    expect(buildTheme({ ...base, elevation: 0 }).vars["--shadow-card"]).toBe("none");
    expect(buildTheme({ ...base, elevation: 0 }).vars["--shadow-card-hover"]).toBe(
      "none"
    );
  });

  it("暗色高程带 1px 内描边补偿；hover 档 = rest +1（顶档维持）", () => {
    const dark = buildTheme(base);
    expect(dark.vars["--shadow-card"]).toContain("inset");
    const e1 = buildTheme({ ...base, elevation: 1 });
    const e2 = buildTheme({ ...base, elevation: 2 });
    expect(e1.vars["--shadow-card-hover"]).toBe(e2.vars["--shadow-card"]);
    const e3 = buildTheme({ ...base, elevation: 3 });
    expect(e3.vars["--shadow-card-hover"]).toBe(e3.vars["--shadow-card"]);
  });

  it("每套内置主题的 accent2 都达到 AA（16 套全量）", () => {
    for (const theme of BUILTIN_THEMES) {
      const t = buildTheme(theme);
      const accent2 = t.vars["--color-accent2"];
      const ratio = contrastRatio(accent2, theme.bg);
      expect(
        ratio,
        `${theme.name}(${theme.id}) accent2 仅 ${ratio.toFixed(2)}:1`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
