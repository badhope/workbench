/**
 * README 截图脚本（开发辅助，不参与应用运行）。
 *
 * 用 Playwright(chromium) 打开 `vite preview` 的浏览器演示模式，逐页截图
 * 到 docs/screenshots/。早期版本走裸 CDP + 无头 Edge，但 Edge 的合成器
 * 在「fixed 全屏 dataURL 背景」场景下 captureScreenshot 只输出背景层
 * （DOM 完好、截图缺内容），Playwright 的 chromium 没有这个问题 ——
 * 与 e2e 同一浏览器栈，渲染结果可信。
 *
 * 为什么必须用演示模式：非 Tauri 环境下 store 注入 src/lib/demo.ts 的静态
 * 数据，所有路径都写死为 "[path redacted]"。脚本有一道断言，页面若没出现
 * "演示" 标记就直接拒绝截图，防止把开发机上的真实进程、项目路径、主机名
 * 截进公开仓库。
 *
 * 前置：npm run build && npm run preview（http://localhost:4173）
 * 用法：
 *   node scripts/shoot_docs.mjs                # 英文（默认）
 *   node scripts/shoot_docs.mjs --lang=zh      # 中文套件（docs/screenshots/zh/）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argUrl = process.argv.find((a) => a.startsWith("http"));
const BASE = argUrl || "http://localhost:4173";

const langArg = process.argv.find((a) => a.startsWith("--lang="));
const LANG = langArg ? langArg.split("=")[1] : "en";
const OUT_DIR = path.resolve(
  HERE,
  "..",
  "docs",
  "screenshots",
  LANG === "en" ? "" : LANG
);
const VIEW = { width: 1440, height: 900, deviceScaleFactor: 1 };

/** 侧边栏顺序，与 src/App.tsx 的 NAV 保持一致 */
const PAGES = [
  { key: "overview", file: "01-overview.png" },
  { key: "processes", file: "02-processes.png" },
  { key: "servers", file: "03-servers.png" },
  { key: "ai", file: "04-ai-sessions.png" },
  { key: "costs", file: "05-costs.png" },
  { key: "projects", file: "07-projects.png" },
  { key: "tasks", file: "08-tasks.png" },
  { key: "settings", file: "09-settings.png" },
  { key: "logs", file: "10-logs.png" },
];

/** 额外镜头：不只拍「每页一张」，还要拍这次交付的新交互与新特效。 */
const SHOTS = [
  {
    file: "17-process-tree.png",
    page: "processes",
    prepare: async (page) => {
      await page.locator('button[data-proc-view="tree"]').click();
      await page.waitForTimeout(800);
    },
  },
  {
    file: "18-command-palette.png",
    page: null,
    prepare: async (page) => {
      await page.keyboard.press("ControlOrMeta+k");
      await page.waitForTimeout(400);
      await page.keyboard.type("node", { delay: 30 });
      await page.waitForTimeout(500);
    },
    close: async (page) => {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    },
  },
  {
    // 视觉 2.0：氛围粒子（亮色 Frost + 强度 70）
    file: "19-particles.png",
    page: "overview",
    seed: { particles: true, particlesIntensity: 70 },
  },
  {
    // 视觉 2.0：自定义背景图（运行时生成的渐变壁纸，不用真实图片）
    file: "20-background.png",
    page: "costs",
    seed: { backgroundImage: "@gradient" },
  },
  {
    // 视觉 2.0：空态插画（进程搜索无结果）
    file: "21-empty-art.png",
    page: "processes",
    prepare: async (page) => {
      const input = page
        .locator("main input[type='text'], main input:not([type])")
        .first();
      await input.fill("zzz-not-exist");
      await page.waitForTimeout(700);
    },
  },
  {
    // 首启引导（本镜头单独不带 onboardingDone 种子）
    file: "22-onboarding.png",
    page: null,
    seed: { onboardingDone: false },
    close: async (page) => {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    },
  },
  {
    // 暗色主题代表：Midnight
    file: "23-dark-overview.png",
    page: "overview",
    seed: { theme: "midnight" },
  },
  {
    // 玻璃材质代表：Midnight Aurora（光晕 + 半透明外壳）
    file: "24-glass-aurora.png",
    page: "costs",
    seed: { theme: "midnight-aurora" },
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 种 UI 偏好（zustand persist v6）+ 界面语言，reload 后主题/引导管线完整
 * 跑一遍。默认亮色 Frost + 引导已阅；镜头用 seed 覆盖任意字段。
 */
async function seedStore(page, extra = {}) {
  await page.evaluate(
    ({ lang, extra }) => {
      localStorage.setItem("workbench-lang", lang);
      localStorage.setItem(
        "workbench-ui-v1",
        JSON.stringify({
          state: { theme: "frost", onboardingDone: true, lang, ...extra },
          version: 6,
        })
      );
    },
    { lang: LANG, extra }
  );
}

async function gotoPage(page, key, keys) {
  const label = {
    overview: "Overview|总览|概览|概要",
    processes: "Processes|进程|プロセス",
    servers: "Servers|服务|サーバー",
    ai: "AI sessions|AI",
    costs: "Cost ledger|成本|コスト",
    projects: "Projects|项目|プロジェクト",
    tasks: "Tasks|任务|タスク",
    settings: "Settings|设置|設定",
    logs: "Logs|日志|ログ",
  }[key];
  const item = page
    .locator(`nav[aria-label="Primary"] .nav-item`, { hasText: new RegExp(label) })
    .first();
  await item.click();
  await sleep(1100); // 等懒加载 chunk 与图表渲染
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: VIEW,
    deviceScaleFactor: VIEW.deviceScaleFactor,
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await seedStore(page, {});
  await page.reload({ waitUntil: "networkidle" });
  await sleep(1500);

  // 断言确实处于演示模式：否则拒绝截图，避免泄漏真实数据。
  const isDemo = await page.evaluate(() =>
    ["演示", "Demo", "デモ"].some((m) => document.body.innerText.includes(m))
  );
  if (!isDemo) throw new Error("未检测到演示模式标记，拒绝截图（防止泄漏真实数据）");

  const keys = PAGES.map((p) => p.key);
  for (const { key, file } of PAGES) {
    await gotoPage(page, key, keys);
    await page.keyboard.press("Escape"); // 关掉可能残留的浮层
    await sleep(200);
    await page.screenshot({ path: path.join(OUT_DIR, file) });
    console.log(`  ${file}`);
  }

  // Hero：页头品牌区（logo + 标题 + 副标题）。三份 README 的首图，坐标
  // 基于 1440×900 视口下的概览页页头（侧栏 220px + 标题区）。
  await gotoPage(page, "overview", keys);
  await page.screenshot({
    path: path.join(OUT_DIR, "12-brand-hero.png"),
    clip: { x: 236, y: 56, width: 820, height: 120 },
  });
  console.log("  12-brand-hero.png");

  for (const shot of SHOTS) {
    if (shot.seed) {
      const seed = { ...shot.seed };
      if (seed.backgroundImage === "@gradient") {
        // 在页面里现生成一张渐变壁纸，不引入真实图片资产
        seed.backgroundImage = await page.evaluate(() => {
          const c = document.createElement("canvas");
          c.width = 1920;
          c.height = 1080;
          const x = c.getContext("2d");
          const g = x.createLinearGradient(0, 0, 1920, 1080);
          g.addColorStop(0, "#0ea5b7");
          g.addColorStop(0.55, "#7c6cf0");
          g.addColorStop(1, "#f0a6b8");
          x.fillStyle = g;
          x.fillRect(0, 0, 1920, 1080);
          return c.toDataURL("image/jpeg", 0.85);
        });
      }
      await seedStore(page, seed);
      await page.reload({ waitUntil: "networkidle" });
      await sleep(1800);
    }
    if (shot.page) await gotoPage(page, shot.page, keys);
    await shot.prepare?.(page);
    await page.screenshot({ path: path.join(OUT_DIR, shot.file) });
    console.log(`  ${shot.file}`);
    if (shot.close) await shot.close(page);
  }

  await browser.close();
  console.log(`完成：${PAGES.length + SHOTS.length + 1} 张 -> ${OUT_DIR}`);
}

main().catch((e) => {
  console.error("截图失败:", e.message);
  process.exit(1);
});
