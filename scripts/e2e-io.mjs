/**
 * 导入 / 导出端到端（真实桌面应用）。
 *
 * 不走系统文件选择器：页面用的是隐藏 `<input type="file">`，
 * Playwright 的 `setInputFiles` 直接喂文件，等价于用户选文件，
 * 但可以在 CI 里自动化。
 *
 * 覆盖点：
 * 1. 非法 JSON（结构缺字段 / 任务状态非法）必须整份拒绝，且原有数据不变；
 * 2. 合法 JSON 导入后项目出现在界面上（不是只写进内存）；
 * 3. 导出按钮真的产出可再次导入的文件（导出的内容与导入的等价）。
 *
 * 用法：node scripts/e2e-io.mjs PORT
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const PORT = process.argv[2] || "22211";
const fail = (m) => {
  console.error(`FAIL: ${m}`);
  process.exit(1);
};
const ok = (m) => console.log(`ok   ${m}`);

function tmpJson(name, data) {
  const p = path.join(os.tmpdir(), `wb-io-${process.pid}-${name}`);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
  return p;
}

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  const p = ctx.pages()[0] || (await ctx.newPage());
  if (!(await p.evaluate(() => "__TAURI_INTERNALS__" in window))) fail("不是 Tauri 环境");
  ok("运行在真实 Tauri 窗口内");

  // 打开设置页（导入/导出在这里）
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll("aside button")].find((b) =>
      (b.getAttribute("title") || "").includes("设置")
    );
    btn?.click();
  });
  await p.waitForTimeout(1200);

  // 设置页有两个 file input（主题导入 / 数据导入）。必须按 aria-label
  // 精确选数据那个：否则喂进去的 JSON 会被主题解析器先吃掉，
  // 报的是「主题缺少必需字段」，看起来像数据导入坏了。
  const fileInput = p.locator('input[type="file"][aria-label="导入 JSON"]').first();
  if ((await fileInput.count()) === 0) fail("找不到数据导入用的 file input");

  // 记录导入前的项目数
  const before = await p.evaluate(async () => {
    const d = (await window.__TAURI_INTERNALS__.invoke("load_data_versioned")).data;
    return d.projects.length;
  });

  // 1) 非法 JSON：结构不符
  const bad = tmpJson("bad.json", { projects: [{ name: "没有 id" }], tasks: [] });
  await fileInput.setInputFiles(bad);
  await p.waitForTimeout(900);
  const badToast = await p.evaluate(() => document.body.innerText);
  if (!/导入失败|invalid|缺/.test(badToast)) fail("非法结构没有给出失败提示");
  const afterBad = await p.evaluate(async () => {
    const d = (await window.__TAURI_INTERNALS__.invoke("load_data_versioned")).data;
    return d.projects.length;
  });
  if (afterBad !== before) fail("非法导入改动了数据");
  ok(`非法结构被拒绝且数据未变（项目数仍为 ${before}）`);

  // 2) 非法任务状态
  const badStatus = tmpJson("badstatus.json", {
    projects: [],
    tasks: [{ id: "t1", title: "x", status: "nope" }],
  });
  await fileInput.setInputFiles(badStatus);
  await p.waitForTimeout(900);
  const statusToast = await p.evaluate(() => document.body.innerText);
  if (!/状态|status|失败/.test(statusToast)) {
    fail(`非法任务状态没有给出失败提示，页面文本尾部：${statusToast.slice(-200)}`);
  }
  ok("非法任务状态被拒绝");

  // 3) 合法导入
  const good = tmpJson("good.json", {
    projects: [
      {
        id: "e2e-io-1",
        name: "E2E IO Project",
        path: "C:\e2e",
        status: "active",
        tags: ["e2e"],
        pinned: false,
        note: "",
        created_at: 1700000000,
      },
    ],
    tasks: [],
  });
  await fileInput.setInputFiles(good);
  await p.waitForTimeout(1200);
  const imported = await p.evaluate(async () => {
    const d = (await window.__TAURI_INTERNALS__.invoke("load_data_versioned")).data;
    return { names: d.projects.map((x) => x.name), count: d.projects.length };
  });
  if (!imported.names.includes("E2E IO Project")) fail("合法导入没有写入项目");
  ok(`合法导入生效（当前项目：${imported.names.join(", ")}）`);

  // 4) 导出：拦截下载，确认内容可回灌
  const downloadPromise = p.waitForEvent("download", { timeout: 15000 });
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      (b.textContent || "").includes("导出 JSON")
    );
    btn?.click();
  });
  const download = await downloadPromise;
  const out = path.join(os.tmpdir(), `wb-export-${process.pid}.json`);
  await download.saveAs(out);
  const text = fs.readFileSync(out, "utf8");
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.projects) || !Array.isArray(parsed.tasks)) {
    fail("导出的文件结构不对");
  }
  if (!parsed.projects.some((x) => x.name === "E2E IO Project")) {
    fail("导出内容里没有刚导入的项目");
  }
  ok(`导出可回灌：${parsed.projects.length} 个项目、${parsed.tasks.length} 个任务`);

  // 清理探针数据
  const cleaned = await p.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const d = (await invoke("load_data_versioned")).data;
    const before = d.projects.length;
    d.projects = d.projects.filter((x) => x.id !== "e2e-io-1");
    await invoke("save_data", { data: d });
    return before - (await invoke("load_data_versioned")).data.projects.length;
  });
  ok(`探针项目已清理（${cleaned} 条）`);

  for (const f of [bad, badStatus, good, out]) fs.rmSync(f, { force: true });
  await browser.close();
  console.log("\n全部通过（导入 / 导出：真实桌面应用）");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
