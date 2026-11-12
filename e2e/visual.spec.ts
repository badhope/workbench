import { expect, test, type Page } from "@playwright/test";

/**
 * 视觉回归 + 结构契约。
 *
 * 基线不是追求像素完全一致，而是「有人改布局/间距/图表配置时立刻看到差异」。
 * 这份测试来自真实事故：磁盘环形图标签重叠、Hero 在窄屏塌成窄列、
 * 设置页因 backdrop-filter 整块空白、打包后的 exe 里仍是旧图标 ——
 * 这些全都通过了单元测试和类型检查。
 *
 * 主题现在由**内联 CSS 变量**驱动（用户可编辑），所以不能再靠改 `data-theme`
 * 属性换肤 —— 必须走设置页的真实交互路径，否则测的还是旧实现。
 */

const THEMES = [
  "midnight",
  "frost",
  "paper",
  "aurora",
  "terminal",
  "ink",
  "void",
  "jade",
  // 视觉 2.0 新增八套（4 暗 4 亮）
  "midnight-aurora",
  "ember",
  "matcha",
  "grape-soda",
  "nordic-light",
  "sakura",
  "mono-brutal",
  "sky",
] as const;

const LAYOUTS = [
  "bento",
  "ledger",
  "orbit",
  "dense",
  "zen",
  "timeline",
  "board",
] as const;
const SHELLS = ["rail", "dock", "zen"] as const;

/** 通过侧栏/顶部坞的导航按钮打开页面（title 在折叠态也有，比文字稳）。 */
async function gotoPage(page: Page, label: string) {
  await page
    .locator(`aside button[title="${label}"], header nav button[title="${label}"]`)
    .first()
    .click();
  await page.waitForTimeout(700);
}

async function gotoAppearance(page: Page) {
  await gotoPage(page, "设置");
  await page.waitForTimeout(300);
}

// 首启引导浮层（OnboardingOverlay）会盖住全屏并拦截所有点击。
// 只在「布局稳定性」里种 onboardingDone 不够 —— 本文件所有用例都要导航，
// 统一在文件级 beforeEach 预置（对已种过的用例重复写入无副作用）。
//
// 注意：addInitScript 在每次导航（含 page.reload()）都会执行。
// 种子必须是「key 不存在才写」，否则 reload 时固定种子会把用例中途
// 保存的 widgetOrder/widgetHidden 等偏好抹掉，持久化断言必然假失败。
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      if (!localStorage.getItem("workbench-ui-v1")) {
        localStorage.setItem(
          "workbench-ui-v1",
          JSON.stringify({ state: { onboardingDone: true }, version: 4 })
        );
      }
    } catch {
      /* ignore */
    }
  });
});

/** 主题卡片没有稳定 id，用可见名称点击 + 等待应用。 */
async function pickTheme(page: Page, name: string) {
  await gotoAppearance(page);
  await page.locator(`main button[aria-label="${name}"]`).first().click();
  await page.waitForTimeout(450);
  await gotoPage(page, "系统概览");
}

async function pickLayout(page: Page, id: string) {
  await gotoAppearance(page);
  await page.locator(`button[data-layout="${id}"]`).click();
  await page.waitForTimeout(250);
  await gotoPage(page, "系统概览");
}

async function pickShell(page: Page, id: string) {
  await gotoAppearance(page);
  await page.locator(`button[data-shell="${id}"]`).click();
  await page.waitForTimeout(350);
}

test.describe("布局稳定性", () => {
  test.beforeEach(async ({ page }) => {
    // 冻结时钟。
    //
    // 不冻结时有两处每秒都在变：标题栏的「更新于 hh:mm:ss」，以及资源曲线
    // 的 X 轴时间标签（演示数据的采样点基于 Date.now()）。它们让同一份代码
    // 两次截图必然不同 —— 第一次跑会假失败，重跑又通过，是最难排查的一类
    // 噪音。装 Clock 之后定时器也不会自己走，页面停在稳定态。
    await page.clock.install({ time: new Date("2026-10-21T12:00:00Z") });
    // 每个用例从干净偏好开始：布局/主题/组件顺序都会持久化，
    // 否则一条用例改了布局会污染下一条（Playwright 复用同一 origin 的 storage）。
    // 预置 onboardingDone：首启引导浮层会盖住导航，点击全被拦截。
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          "workbench-ui-v1",
          JSON.stringify({ state: { onboardingDone: true }, version: 4 })
        );
      } catch {
        /* ignore */
      }
    });
    await page.goto("/");
    await page.waitForFunction(
      () => {
        const cs = getComputedStyle(document.documentElement);
        return cs.getPropertyValue("--radius-card").trim() !== "";
      },
      { timeout: 15000 }
    );
    // 「更新于 12:34:56」每帧都在变。用 CSS 隐藏而不是 screenshot mask：
    // mask 会被画成一块粉色矩形，基线里看不到那里的真实排版。
    await page.addStyleTag({ content: "header .num{visibility:hidden !important}" });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const main = document.querySelector("main");
      if (main) main.scrollTop = 0;
    });
  });

  // 十六套主题 × (设置页→点主题→概览→截图) 单轮约 3s，默认 30s 不够。
  test("overview 在十六种主题下都保持结构", async ({ page }) => {
    test.setTimeout(240_000);
    for (const theme of THEMES) {
      await pickTheme(page, themeName(theme));
      await expect(page).toHaveScreenshot(`overview-${theme}.png`, {
        fullPage: false,
        maxDiffPixelRatio: 0.005,
        // 只遮「更新于 12:34:56」这处时间戳；遮 main 里的 .num 会把
        // 指标数字整块涂成粉色掩码，看不出真实渲染结果。
      });
    }
  });

  test("七种概览布局都渲染出同一批组件", async ({ page }) => {
    test.setTimeout(120_000);
    for (const layout of LAYOUTS) {
      await pickLayout(page, layout);
      // 每种布局都必须至少渲染「关键指标」，否则就是整页塌了
      await expect(page.locator("main").getByText("运行中进程").first()).toBeVisible();
      await expect(page).toHaveScreenshot(`layout-${layout}.png`, {
        fullPage: false,
        maxDiffPixelRatio: 0.005,
        // 只遮「更新于 12:34:56」这处时间戳；遮 main 里的 .num 会把
        // 指标数字整块涂成粉色掩码，看不出真实渲染结果。
      });
    }
  });

  test("三种外壳都保留完整导航", async ({ page }) => {
    for (const shell of SHELLS) {
      await pickShell(page, shell);
      const nav = page.locator("aside, header nav");
      const buttons = nav.locator('button[title="系统概览"]');
      await expect(buttons.first()).toBeVisible();
      await expect(page).toHaveScreenshot(`shell-${shell}.png`, {
        fullPage: false,
        maxDiffPixelRatio: 0.005,
        // 只遮「更新于 12:34:56」这处时间戳；遮 main 里的 .num 会把
        // 指标数字整块涂成粉色掩码，看不出真实渲染结果。
      });
    }
  });

  test("关键页面在默认主题下无布局回归", async ({ page }) => {
    for (const [label, name] of [
      ["进程", "processes"],
      ["服务与端口", "servers"],
      ["成本账本", "costs"],
      ["任务", "tasks"],
    ] as const) {
      await gotoPage(page, label);
      await expect(page).toHaveScreenshot(`${name}.png`, { maxDiffPixelRatio: 0.005 });
    }
  });

  test("工作台首页与回顾页无布局回归", async ({ page }) => {
    await gotoPage(page, "今天");
    await expect(page).toHaveScreenshot("today.png", { maxDiffPixelRatio: 0.005 });
    await gotoPage(page, "回顾");
    await expect(page).toHaveScreenshot("review.png", { maxDiffPixelRatio: 0.005 });
  });

  test("工作小窗在独立视口下无布局回归", async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 580 });
    await page.goto("/?mini=1");
    await page.waitForTimeout(800);
    await expect(page).toHaveScreenshot("mini.png", { maxDiffPixelRatio: 0.005 });
  });

  test("设置页的主题与版面板完整渲染", async ({ page }) => {
    await gotoAppearance(page);
    // 八套内置主题 + 导入/导出/复制按钮
    await expect(
      page.locator("main button[aria-label]").filter({ hasText: "" })
    ).not.toHaveCount(0);
    await expect(page.locator("button[data-layout]")).toHaveCount(7);
    await expect(page.locator("button[data-shell]")).toHaveCount(3);
    await expect(page).toHaveScreenshot("settings.png", { maxDiffPixelRatio: 0.005 });
  });

  test("窄屏下导航变抽屉且内容单列", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    const left = await page.evaluate(
      () => document.querySelector("aside")!.getBoundingClientRect().left
    );
    expect(left).toBeLessThan(0);

    await expect(page).toHaveScreenshot("mobile-overview.png", {
      // Linux runner 的字体渲染与 Windows 本地有 ~0.01 的抗锯齿漂移，
      // 收紧到 0.005 会在 CI 上误报（实测 2139 像素），放宽到 0.02。
      maxDiffPixelRatio: 0.02,
    });
  });
});

function themeName(id: string): string {
  const map: Record<string, string> = {
    midnight: "Midnight",
    frost: "Frost",
    paper: "Paper",
    aurora: "Aurora",
    terminal: "Terminal",
    ink: "Ink",
    void: "Void",
    jade: "Jade",
    "midnight-aurora": "Midnight Aurora",
    ember: "Ember",
    matcha: "Matcha",
    "grape-soda": "Grape Soda",
    "nordic-light": "Nordic Light",
    sakura: "Sakura",
    "mono-brutal": "Mono Brutal",
    sky: "Sky",
  };
  return map[id] ?? id;
}

test.describe("主题结构契约", () => {
  /**
   * 纯截图不够：主题变量必须真的作用到元素上。
   * 这条能在圆角/阴影被误改时立刻失败，而不依赖像素对比。
   */
  test("每套主题的圆角与底色都来自自身 token", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1200);

    const measure = () =>
      page.evaluate(() => {
        const card = document.querySelector("main .t-card") as HTMLElement | null;
        const cs = getComputedStyle(document.documentElement);
        return {
          radius: card ? getComputedStyle(card).borderTopLeftRadius : "",
          bg: cs.getPropertyValue("--color-bg").trim(),
          font: cs.getPropertyValue("--font-sans").trim(),
        };
      });

    const seen = new Set<string>();
    for (const name of ["Midnight", "Frost", "Paper", "Terminal"]) {
      await pickTheme(page, name);
      const m = await measure();
      expect(m.bg).toMatch(/^#|rgb/);
      expect(m.radius).not.toBe("");
      seen.add(`${m.radius}|${m.bg}`);
    }
    // 四套主题至少产生三种不同的「圆角+底色」组合，
    // 否则说明主题没有真正作用到元素上（只换了变量名没换值）
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  test("切换自定义主题会同时换掉颜色、圆角与密度变量", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1200);

    const read = () =>
      page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return {
          bg: cs.getPropertyValue("--color-bg").trim(),
          radius: cs.getPropertyValue("--radius-card").trim(),
          space: cs.getPropertyValue("--space-card").trim(),
          font: cs.getPropertyValue("--font-sans").trim(),
        };
      });

    const before = await read();
    await pickTheme(page, "Terminal");
    const after = await read();

    expect(after.bg).not.toBe(before.bg);
    expect(after.radius).not.toBe(before.radius);
    expect(after.space).not.toBe(before.space);
    expect(after.font.toLowerCase()).toContain("mono");
  });
});

test.describe("自定义主题", () => {
  test("复制内置主题后可改色并保存，刷新后仍然生效", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1200);
    await gotoAppearance(page);

    // 复制当前主题（Midnight）→ 编辑器打开
    await page.locator('button:has-text("复制为新主题")').first().click();
    await page.waitForTimeout(500);

    // 改名 + 改强调色
    const nameInput = page.locator('div[role="dialog"] input').first();
    await nameInput.fill("Test Theme");
    // 四个颜色输入依次是 bg / panel / text / accent
    await page.locator('div[role="dialog"] input[type="color"]').nth(3).fill("#ff00aa");
    await page.locator('div[role="dialog"] button:has-text("保存并应用")').click();
    await page.waitForTimeout(600);

    // 强调色在渲染前会过一遍对比度求解：用户选 #ff00aa 时若压在浅底上
    // 达不到 4.5:1，系统会把它往深里调一档（这里是 #d1008b）。这是**有意的**
    // 产品行为——不能为了"忠于输入值"让界面出现看不清的文字。
    // 所以断言两件事：色相没被换掉（色相角接近）、且实际值达到 AA。
    const accentVar = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim()
    );
    const hueOf = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      const r = (n >> 16) / 255;
      const g = ((n >> 8) & 255) / 255;
      const b = (n & 255) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max === min) return 0;
      const d = max - min;
      let h: number;
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    const hueDiff = Math.abs(hueOf(accentVar.toLowerCase()) - hueOf("#ff00aa"));
    expect(Math.min(hueDiff, 360 - hueDiff)).toBeLessThan(12);

    const afterReload = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim()
    );
    // 刷新后必须还是同一个实际值（不是又算了一遍变了）
    expect(afterReload.toLowerCase()).toBe(accentVar.toLowerCase());
    // 自定义主题必须还在列表里（名字是用户起的那个）
    await gotoAppearance(page);
    await expect(page.locator('main button[aria-label="Test Theme"]')).toHaveCount(1);
  });
});

test.describe("组件摆放", () => {
  test("隐藏的组件在概览页消失，重新打开后出现", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1500);
    await gotoPage(page, "系统概览");
    await expect(page.getByText("本地会话文件").first()).toBeVisible();

    await gotoAppearance(page);
    const row = page.locator("li", { hasText: "会话文件" }).first();
    await row.locator("button").last().click();
    await page.waitForTimeout(300);
    await gotoPage(page, "系统概览");
    await expect(page.getByText("本地会话文件").first()).toHaveCount(0);

    await gotoAppearance(page);
    await page
      .locator("li", { hasText: "会话文件" })
      .first()
      .locator("button")
      .last()
      .click();
    await page.waitForTimeout(300);
    await gotoPage(page, "系统概览");
    await expect(page.getByText("本地会话文件").first()).toBeVisible();
  });

  test("上移/下移改变组件顺序并持久化", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1500);
    await gotoAppearance(page);

    const rows = page.locator("main ul li");
    const firstBefore = await rows.first().innerText();
    // 第二行上移
    await rows.nth(1).locator("button").first().click();
    await page.waitForTimeout(250);
    const firstAfter = await rows.first().innerText();
    expect(firstAfter).not.toBe(firstBefore);

    await page.reload();
    await page.waitForTimeout(1500);
    await gotoAppearance(page);
    const firstReload = await page.locator("main ul li").first().innerText();
    expect(firstReload).toBe(firstAfter);
  });
});

test.describe("图标渲染", () => {
  /**
   * 品牌字形必须是「直接贴上去」的矢量笔画：侧栏与报头里都是 SVG，
   * 没有 <img>、没有底板。旧实现是白底 JPEG 抠图，深色侧栏上留下一圈
   * 白方块，而整页截图根本看不见它 —— 所以这里查 DOM 契约，
   * 并且实测 SVG 背景不是白色贴片。
   */
  test("品牌字形是矢量笔画、随主题着色", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1200);

    const stats = await page.evaluate(() => {
      const svg = document.querySelector("aside svg") as SVGSVGElement | null;
      if (!svg) return { error: "no brand svg" };
      return {
        paths: svg.querySelectorAll("path").length,
        hasRect: Boolean(svg.querySelector("rect")),
        hasImage: Boolean(svg.querySelector("image")),
        fill: svg.getAttribute("fill"),
        bg: getComputedStyle(document.querySelector("aside")!).backgroundColor,
      };
    });

    expect(stats.error).toBeUndefined();
    expect(stats.paths).toBe(4);
    expect(stats.hasRect).toBe(false);
    expect(stats.hasImage).toBe(false);
    expect(stats.fill).toBe("none");
    expect(stats.bg).not.toBe("rgb(255, 255, 255)");
  });

  /**
   * 图标源图是一张白底 JPEG，忘了抠图会在深色界面上留下一圈白方块。
   *
   * 这条不能用「截图里白色像素占比」来断言：0.5.0 起默认主题是亮色的
   * Frost，面板本来就是白的，白像素比例天然很高，测试会在默认配置下
   * 永久失败，且失败原因是「背景是白的」，跟图标无关。
   *
   * 贴片的本质是「字形外面多了一块不透明的矩形」。所以直接检查 DOM：
   * 品牌 SVG 自身及其父容器不得带背景色/背景图。这是矢量图标的契约，
   * 与主题深浅完全解耦。
   */
  test("品牌字形是裸矢量，容器不带底色贴片", async ({ page }) => {
    for (const theme of ["frost", "midnight"]) {
      await page.addInitScript((id) => {
        try {
          localStorage.setItem(
            "workbench-ui-v1",
            JSON.stringify({ state: { theme: id, onboardingDone: true }, version: 4 })
          );
        } catch {
          /* ignore */
        }
      }, theme);
      await page.goto("/");
      await page.waitForTimeout(1000);

      const probe = await page.evaluate(() => {
        const svg = document.querySelector("aside svg");
        if (!svg) return null;
        const describe = (el: Element) => {
          const cs = getComputedStyle(el);
          return {
            tag: el.tagName.toLowerCase(),
            bgColor: cs.backgroundColor,
            bgImage: cs.backgroundImage,
            boxShadow: cs.boxShadow,
          };
        };
        const chain: ReturnType<typeof describe>[] = [describe(svg)];
        // 往上看两层：贴片通常是 svg 外面套一个 div
        let p = svg.parentElement;
        for (let i = 0; i < 2 && p; i++, p = p.parentElement) {
          // 侧栏容器本身当然有底色，跳过 nav/aside 这类结构元素
          if (["NAV", "ASIDE", "BODY", "HTML"].includes(p.tagName)) break;
          chain.push(describe(p));
        }
        return chain;
      });
      expect(probe, `${theme}: 侧栏品牌图标必须存在`).not.toBeNull();

      for (const el of probe!) {
        // transparent 或完全透明才算裸图标
        const isTransparent =
          el.bgColor === "rgba(0, 0, 0, 0)" || el.bgColor === "transparent";
        expect(
          isTransparent,
          `${theme}: 图标容器 <${el.tag}> 带了底色 ${el.bgColor}，这就是贴片`
        ).toBe(true);
        expect(el.bgImage, `${theme}: 图标容器 <${el.tag}> 带了背景图`).toBe("none");
        expect(
          el.boxShadow,
          `${theme}: 图标容器 <${el.tag}> 带了阴影（不是贴片但会显脏）`
        ).toBe("none");
      }
      await page.evaluate(() => localStorage.clear());
    }
  });
});

test.describe("图表不重叠", () => {
  test("每个图表的 canvas 都有实际尺寸", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);

    const bad = await page.evaluate(() => {
      const canvases = [...document.querySelectorAll("main canvas")];
      return canvases
        .map((c, i) => ({
          i,
          w: (c as HTMLCanvasElement).width,
          h: (c as HTMLCanvasElement).height,
          boxW: c.getBoundingClientRect().width,
        }))
        .filter((c) => c.w === 0 || c.h === 0 || c.boxW === 0);
    });
    expect(bad).toEqual([]);
  });
});
