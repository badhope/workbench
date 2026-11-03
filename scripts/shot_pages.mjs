// 页面视觉自检截图：指定 base URL，按主题 × 页面输出 PNG。
//
// 用途：改视觉前先拍「现状」，改完再拍「效果」，人眼对比 + 给 diff 工具。
// 浏览器演示模式（非 Tauri）下运行，数据全部来自 demoBundle，不碰真实机器。
//
// 用法：
//   node scripts/shot_pages.mjs [--url=http://localhost:4173] [--out= shots] \
//        [--themes=frost,midnight,aurora] [--pages=overview,costs] [--lang=zh]
//
// 主题通过 localStorage 种子设置（zustand persist 的 workbench-ui-v1），
// 与桌面端持久化格式一致，所以截到的就是真实主题管线渲染的结果。
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  })
);
const BASE = args.url || "http://localhost:4173";
const LANG = args.lang || "zh";
const OUT = path.resolve(args.out || "shots");
const THEMES = String(args.themes || "frost,midnight,aurora,jade").split(",");
const PAGES = String(
  args.pages || "overview,processes,servers,costs,tasks,settings"
).split(",");

const NAV = { overview: "总览", processes: "进程", servers: "服务", costs: "成本", tasks: "任务", settings: "设置", logs: "日志" };

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});

for (const theme of THEMES) {
  // 先进一次首页写种子，再刷新让主题管线（applyTheme）完整跑一遍
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => {
    localStorage.setItem(
      "workbench-ui-v1",
      JSON.stringify({ state: { theme: t, lang: "zh" }, version: 3 })
    );
  }, theme);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  for (const p of PAGES) {
    // 侧栏导航按钮（nav-item）：精确匹配文案后点击；失败再用命令面板
    const label = NAV[p] || p;
    const item = page
      .locator(`nav[aria-label="Primary"] .nav-item`, { hasText: label })
      .first();
    if (await item.count()) {
      await item.click();
    } else {
      // 命令面板兜底：Ctrl+K → 输入页面名 → 点匹配项
      await page.keyboard.press("ControlOrMeta+k");
      await page.waitForTimeout(200);
      await page.keyboard.type(p, { delay: 40 });
      await page.waitForTimeout(300);
      await page.keyboard.press("Enter");
    }
    await page.waitForTimeout(900);
    // 兜底关掉可能残留的浮层，避免挡住截图
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    const file = path.join(OUT, `${theme}-${p}-${LANG}.png`);
    await page.screenshot({ path: file });
    console.log("  ", file);
  }
}

await browser.close();
console.log(`完成：${THEMES.length} 主题 × ${PAGES.length} 页面 → ${OUT}`);
void writeFileSync; // keep import if unused later
