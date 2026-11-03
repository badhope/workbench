import { expect, test, type Page } from "@playwright/test";

/**
 * 可读性回归：所有页面 × 全部内置主题，正文与辅助文字必须满足 WCAG AA。
 *
 * 为什么需要浏览器里的测试：`contrast.test.ts` 只能验证 token 推导；
 * 真正的失败往往发生在「某个组件用了 text-faint/50 这类半透明叠加」
 * 或「某处写了硬编码颜色」——那只有把页面渲染出来量才看得见。
 *
 * 早先实测：faint 在浅色主题上只有 2.78:1，界面上完全看不出「不合规」，
 * 单元测试也全绿。
 */

const THEMES = [
  "Midnight",
  "Frost",
  "Paper",
  "Aurora",
  "Terminal",
  "Ink",
  "Void",
  "Jade",
  // 视觉 2.0 新增八套（4 暗 4 亮）
  "Midnight Aurora",
  "Ember",
  "Matcha",
  "Grape Soda",
  "Nordic Light",
  "Sakura",
  "Mono Brutal",
  "Sky",
];
const PAGES = [
  ["概览", "overview"],
  ["进程", "processes"],
  ["服务与端口", "servers"],
  ["AI 会话", "ai"],
  ["成本账本", "costs"],
  ["项目", "projects"],
  ["任务", "tasks"],
  ["设置", "settings"],
  ["运行日志", "logs"],
] as const;

/** 统计当前页面上不满足 WCAG AA 的文字节点。 */
async function contrastFailures(page: Page) {
  return page.evaluate(() => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    // 用 canvas 实际绘制再读像素：任何 CSS 颜色（oklab / color(srgb) /
    // color-mix 的结果）都能被解析成具体 RGB，避免正则解析失败。
    const toRgb = (c: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (c: number) => {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = (el: Element): number[] => {
      let n: Element | null = el;
      while (n) {
        const c = toRgb(getComputedStyle(n).backgroundColor);
        if (c[3] > 0.5) return c.slice(0, 3);
        n = n.parentElement;
      }
      return toRgb(getComputedStyle(document.body).backgroundColor).slice(0, 3);
    };

    const out: { text: string; size: number; ratio: number }[] = [];
    for (const el of document.querySelectorAll("main *, aside *, header *")) {
      if (!el.childNodes.length) continue;
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) {
        continue;
      }
      const cs = getComputedStyle(el);
      const fgRaw = toRgb(cs.color);
      if (fgRaw[3] < 0.05) continue;
      const bg = bgOf(el);
      const fg =
        fgRaw[3] >= 0.99
          ? fgRaw.slice(0, 3)
          : [0, 1, 2].map((i) => fgRaw[i] * fgRaw[3] + bg[i] * (1 - fgRaw[3]));
      const L1 = lum(fg);
      const L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(cs.fontSize);
      const bold = parseInt(cs.fontWeight) >= 700;
      const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      if (ratio < need) {
        out.push({ text: el.textContent!.trim().slice(0, 24), size, ratio });
      }
    }
    return out;
  });
}

test.describe("可读性（WCAG AA）", () => {
  test.setTimeout(240_000);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        // 从干净偏好开始，但预置 onboardingDone：否则首启引导浮层
        // 会盖住导航按钮，后面的点击全被拦截。
        localStorage.setItem(
          "workbench-ui-v1",
          JSON.stringify({ state: { onboardingDone: true }, version: 4 })
        );
      } catch {
        /* ignore */
      }
    });
    await page.goto("/");
    await page.waitForTimeout(1500);
  });

  test("九个页面在默认主题下零失败", async ({ page }) => {
    for (const [label] of PAGES) {
      await page
        .locator(`aside button[title="${label}"], header nav button[title="${label}"]`)
        .first()
        .click();
      await page.waitForTimeout(900);
      const bad = await contrastFailures(page);
      expect(
        bad,
        `${label} 有 ${bad.length} 处低于 AA：${bad
          .slice(0, 3)
          .map((b) => `"${b.text}" ${b.ratio.toFixed(2)}:1 @${b.size}px`)
          .join(", ")}`
      ).toEqual([]);
    }
  });

  test("十六套内置主题在概览页零失败", async ({ page }) => {
    for (const theme of THEMES) {
      await page.locator('aside button[title="设置"]').first().click();
      await page.waitForTimeout(500);
      await page.locator(`main button[aria-label="${theme}"]`).click();
      await page.waitForTimeout(450);
      await page.locator('aside button[title="概览"]').first().click();
      await page.waitForTimeout(900);
      const bad = await contrastFailures(page);
      expect(
        bad,
        `${theme} 有 ${bad.length} 处低于 AA：${bad
          .slice(0, 3)
          .map((b) => `"${b.text}" ${b.ratio.toFixed(2)}:1 @${b.size}px`)
          .join(", ")}`
      ).toEqual([]);
    }
  });
});
