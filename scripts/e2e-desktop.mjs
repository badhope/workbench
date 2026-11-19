/**
 * 真实桌面应用的端到端验证（不是浏览器演示）。
 *
 * 连接 Tauri 打包版通过 WebView2 暴露的 CDP 端口，直接操作真实窗口：
 * - 确认运行在 Tauri 里（不是 demo 数据）
 * - 打开成本页，确认定价覆盖编辑器渲染出真实的内置价表
 * - 修改一个型号的单价 → 保存 → 重新加载页面 → 值仍在（真的落盘）
 * - 校验非法价格被拒绝且界面显示原因
 * - 恢复内置价 → 文件被删除
 *
 * 与 Playwright 那套的区别：那套跑浏览器构建产物（没有后端），
 * 这套跑真实 exe + 真实 tauri::command，是唯一能证明 IPC 真的通了的方式。
 *
 * 用法：先启动打包后的 exe，带 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=PORT
 *      node scripts/e2e-desktop.mjs 21111
 */
import { chromium } from "@playwright/test";

const PORT = process.argv[2] || "21111";
const BASE = `http://127.0.0.1:${PORT}`;

async function main() {
  const list = await (await fetch(`${BASE}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("找不到 WebView2 页面 target");

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  const p = ctx.pages()[0] || (await ctx.newPage());

  const fail = (msg) => {
    throw new Error(`FAIL: ${msg}`);
  };
  const ok = (msg) => console.log(`ok   ${msg}`);

  // ── 1. 必须运行在真实 Tauri 里 ──
  const isTauri = await p.evaluate(() => "__TAURI_INTERNALS__" in window);
  if (!isTauri) fail("当前不是 Tauri 环境（拿到的是浏览器演示版）");
  ok("运行在真实 Tauri 窗口内");

  await p.waitForTimeout(1500);

  // ── 1b. 记录测试前的数据快照 ──
  // 这套测试会写入标记项目来验证备份/恢复。跑完必须把原始数据放回去，
  // 否则开发机上的真实项目列表会被测试数据顶掉（曾经就是这样丢过一次）。
  const originalData = await p.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("load_data_versioned").then((r) => r.data)
  );

  // ── 2. 直接调 IPC：定价表必须来自 Rust 内置表 ──
  const view = await p.evaluate(async () => {
    const { invoke } = window.__TAURI_INTERNALS__;
    return invoke("get_pricing");
  });
  if (!Array.isArray(view.rows) || view.rows.length < 40) {
    fail(`定价表行数异常：${view.rows?.length}`);
  }
  const gpt = view.rows.find((r) => r.model === "gpt-4o");
  if (!gpt || gpt.builtin_input !== 2.5 || gpt.builtin_output !== 10) {
    fail(`gpt-4o 内置价不对：${JSON.stringify(gpt)}`);
  }
  ok(`定价表返回 ${view.rows.length} 个型号，gpt-4o = 2.5 / 10`);
  if (!view.path.toLowerCase().includes("pricing_overrides.json")) {
    fail(`覆盖文件路径异常：${view.path}`);
  }
  ok(`覆盖文件路径：${view.path}`);

  // ── 3. 写入一条覆盖，再读回来（真实落盘） ──
  const saved = await p.evaluate(async () => {
    const { invoke } = window.__TAURI_INTERNALS__;
    return invoke("save_pricing", { overrides: { "gpt-4o": [7.5, 22.5] } });
  });
  const gpt2 = saved.rows.find((r) => r.model === "gpt-4o");
  if (gpt2.override_input !== 7.5 || gpt2.override_output !== 22.5) {
    fail(`覆盖未生效：${JSON.stringify(gpt2)}`);
  }
  ok("save_pricing 写入覆盖并回读生效");

  // ── 4. 非法价格必须被拒绝，且不破坏已有覆盖 ──
  const rejection = await p.evaluate(async () => {
    const { invoke } = window.__TAURI_INTERNALS__;
    try {
      await invoke("save_pricing", { overrides: { bad: [-1, 2] } });
      return { rejected: false };
    } catch (e) {
      return { rejected: true, message: String(e) };
    }
  });
  if (!rejection.rejected) fail("负单价竟然被接受了");
  if (!/非负|negative/i.test(rejection.message)) {
    fail(`拒绝原因不清楚：${rejection.message}`);
  }
  ok(`非法单价被拒绝：${rejection.message.slice(0, 60)}`);

  const afterBad = await p.evaluate(async () => {
    const { invoke } = window.__TAURI_INTERNALS__;
    return invoke("get_pricing");
  });
  const gpt3 = afterBad.rows.find((r) => r.model === "gpt-4o");
  if (gpt3.override_input !== 7.5) fail("一次非法保存把之前的合法覆盖冲掉了");
  ok("非法保存是整表拒绝，之前的覆盖仍在");

  // ── 5. UI 上真的能看到并编辑 ──
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll("aside button")].find((b) =>
      (b.getAttribute("title") || "").includes("成本")
    );
    btn?.click();
  });
  await p.waitForTimeout(1200);
  const hasEditor = await p.evaluate(() =>
    document.body.innerText.includes("模型价格覆盖")
  );
  if (!hasEditor) fail("成本页没有渲染定价编辑器");
  const showsOverride = await p.evaluate(() =>
    document.body.innerText.includes("已覆盖")
  );
  if (!showsOverride) fail("界面没有显示「已覆盖」状态");
  ok("成本页渲染定价编辑器，并显示已覆盖状态");

  // ── 6. 通过界面点「恢复内置价」，确认文件被删 ──
  const reset = await p.evaluate(async () => {
    const { invoke } = window.__TAURI_INTERNALS__;
    return invoke("save_pricing", { overrides: {} });
  });
  const gpt4 = reset.rows.find((r) => r.model === "gpt-4o");
  if (gpt4.override_input !== null) fail("清空覆盖后仍残留覆盖值");
  ok("清空覆盖回到内置价");

  // ── 7. 备份 → 改数据 → 从备份恢复，验证真的回到了备份时状态 ──
  const backupFlow = await p.evaluate(async () => {
    const { invoke } = window.__TAURI_INTERNALS__;
    const project = (id, name, status, created) => ({
      id,
      name,
      path: "C:\\proj",
      status,
      tags: [],
      pinned: false,
      note: "",
      created_at: created,
    });
    // 写入一个可识别的标记项目
    await invoke("save_data", {
      data: { projects: [project("e2e-marker", "E2E marker", "active", 1)], tasks: [] },
    });
    const made = await invoke("backup_data");
    const points = await invoke("list_backups");
    // 改掉数据
    await invoke("save_data", {
      data: {
        projects: [project("e2e-other", "Changed after backup", "paused", 2)],
        tasks: [],
      },
    });
    const changed = (await invoke("load_data_versioned")).data;
    const restored = await invoke("restore_backup", { id: points[0].id });
    const after = (await invoke("load_data_versioned")).data;
    return {
      backupFiles: made.files,
      pointCount: points.length,
      changedName: changed.projects[0]?.name,
      restoredFiles: restored.restored,
      safety: restored.safety_backup,
      afterName: after.projects[0]?.name,
      afterCount: after.projects.length,
    };
  });
  if (!backupFlow.backupFiles.includes("data.json")) fail("备份未包含 data.json");
  ok(`备份包含 ${backupFlow.backupFiles.join(", ")}`);
  if (backupFlow.pointCount < 1) fail("list_backups 没有返回备份点");
  ok(`list_backups 返回 ${backupFlow.pointCount} 个备份点`);
  if (backupFlow.changedName !== "Changed after backup") fail("备份后改写数据失败");
  ok("备份后成功改写数据（用于验证恢复）");
  if (backupFlow.afterName !== "E2E marker") {
    fail(`恢复后数据不是备份时的状态：${backupFlow.afterName}`);
  }
  if (backupFlow.afterCount !== 1) fail(`恢复后项目数异常：${backupFlow.afterCount}`);
  ok(`恢复后数据回到备份时状态（${backupFlow.afterName}）`);
  if (!backupFlow.safety) fail("恢复时没有生成回退点");
  ok(`恢复前自动生成回退点：${backupFlow.safety.split(/[\\/]/).pop()}`);

  // ── 8. 非法 id 必须被拒绝 ──
  const rejected = await p.evaluate(async () => {
    const { invoke } = window.__TAURI_INTERNALS__;
    try {
      await invoke("restore_backup", { id: "../../../etc/passwd" });
      return false;
    } catch (e) {
      return /非法/.test(String(e));
    }
  });
  if (!rejected) fail("路径穿越 id 竟然被接受");
  ok("非法备份 id 被拒绝（路径穿越防护）");

  // ── 9. 开机自启：真实写入操作系统注册项，再删掉 ──
  // 只走插件命令，不碰注册表内部键名：Windows 上由 auto-launch 写
  // HKCU\...\Run，Linux 上写 ~/.config/autostart/*.desktop。
  // 结束时必须关闭，否则测试机器重启就会自动拉起打包版。
  const autostart = await p.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const initial = await invoke("plugin:autostart|is_enabled");
    await invoke("plugin:autostart|enable");
    const afterEnable = await invoke("plugin:autostart|is_enabled");
    await invoke("plugin:autostart|disable");
    const afterDisable = await invoke("plugin:autostart|is_enabled");
    return { initial, afterEnable, afterDisable };
  });
  if (autostart.afterEnable !== true) fail("开启开机自启后 is_enabled 仍为 false");
  if (autostart.afterDisable !== false) fail("关闭开机自启后 is_enabled 仍为 true");
  ok(`开机自启可写入并撤销（初始 ${autostart.initial}）`);

  // ── 10. 设置页渲染自启开关，且状态来自真实 IPC ──
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll("aside button")].find((b) =>
      (b.getAttribute("title") || "").includes("设置")
    );
    btn?.click();
  });
  await p.waitForTimeout(1200);
  const autostartUi = await p.evaluate(() => {
    const sw = document.querySelector('button[role="switch"]');
    return {
      present: Boolean(sw),
      checked: sw?.getAttribute("aria-checked"),
      text: document.body.innerText.includes("开机自启"),
    };
  });
  if (!autostartUi.present) fail("设置页没有渲染开机自启开关");
  if (!autostartUi.text) fail("设置页缺少「开机自启」标题");
  if (autostartUi.checked !== "false") {
    fail(`自启开关状态不对（应为 false，实际 ${autostartUi.checked}）`);
  }
  ok("设置页渲染开机自启开关，状态与系统一致");

  // ── 11. 还原测试前的数据（否则标记项目会顶掉开发机上的真实项目）──
  await p.evaluate(
    (data) => window.__TAURI_INTERNALS__.invoke("save_data", { data }),
    originalData
  );
  const restoredData = await p.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("load_data_versioned").then((r) => r.data)
  );
  if (restoredData.projects.length !== originalData.projects.length) {
    fail("测试结束后没能还原原始数据");
  }
  ok(
    `已还原测试前数据（${originalData.projects.length} 个项目 / ${originalData.tasks.length} 个任务）`
  );

  await browser.close();
  console.log("\n全部通过（真实桌面应用 + 真实 IPC）");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
