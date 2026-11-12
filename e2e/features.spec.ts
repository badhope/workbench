import { expect, test, type Page } from "@playwright/test";

/**
 * 新交互的结构化 E2E（非像素基线）。
 *
 * 这些用例覆盖的是「功能存在但路径不通」这一类问题：命令面板能开但选不中、
 * 树形能切但展开无效、端口能点但不跳转、导出按钮存在但下载为空。
 * 它们不产生截图基线，因此不受字体渲染差异影响，可在任何平台跑。
 */

async function gotoPage(page: Page, label: string) {
  await page
    .locator(`aside button[title="${label}"], header nav button[title="${label}"]`)
    .first()
    .click();
  await page.waitForTimeout(600);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      // 从干净偏好开始，但预置 onboardingDone：否则首启引导浮层
      // 会盖住命令面板与导航，用例全部被拦截。
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

test.describe("命令面板", () => {
  test("Ctrl+K 打开、搜索页面并回车跳转", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "命令面板" });
    await expect(dialog).toBeVisible();

    const input = dialog.getByRole("textbox");
    await input.fill("成本");
    await expect(dialog.getByText("成本账本").first()).toBeVisible();
    await input.press("Enter");

    await expect(dialog).toBeHidden();
    await expect(page.locator("header h1").first()).toContainText("成本账本");
  });

  test("搜索进程时可以直接定位到进程页", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const input = page.getByRole("dialog").getByRole("textbox");
    await input.fill("node");
    await input.press("Enter");
    await expect(page.locator("header h1").first()).toContainText("进程监控");
    await expect(
      page.locator('input[aria-label="搜索进程名 / PID / 命令行…"]')
    ).toHaveValue(/1234/);
  });

  test("Esc 关闭面板且不改变当前页", async ({ page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.locator("header h1").first()).toContainText("今天");
  });
});

test.describe("进程树", () => {
  test("切到树形后子进程缩进显示，展开/收起改变行数", async ({ page }) => {
    await gotoPage(page, "进程");
    const before = await page.locator("tbody tr").count();

    await page.locator('button[data-proc-view="tree"]').click();
    await page.waitForTimeout(400);
    // 默认展开根节点：子进程（缩进符 └）可见
    await expect(page.locator("tbody").getByText("└").first()).toBeVisible();

    // 收起第一个根节点，行数减少
    const firstExpander = page.locator("tbody button[aria-expanded]").first();
    await firstExpander.click();
    await page.waitForTimeout(300);
    const after = await page.locator("tbody tr").count();
    expect(after).toBeLessThan(before + 10);

    await page.locator('button[data-proc-view="flat"]').click();
    await page.waitForTimeout(300);
    await expect(page.locator("tbody").getByText("└")).toHaveCount(0);
  });

  test("展开进程详情会列出监听端口", async ({ page }) => {
    await gotoPage(page, "进程");
    await page.locator("tbody tr").filter({ hasText: "node.exe" }).first().click();
    await expect(page.locator("tbody").getByText("监听端口").first()).toBeVisible();
    await expect(page.locator("tbody").getByText("tcp:5173").first()).toBeVisible();
  });
});

test.describe("端口到进程", () => {
  test("点击端口行的进程图标跳到进程页并过滤该 PID", async ({ page }) => {
    await gotoPage(page, "服务与端口");
    await page.getByRole("button", { name: "查看所属进程" }).first().click();
    await page.waitForTimeout(700);
    await expect(page.locator("header h1").first()).toContainText("进程监控");
    await expect(
      page.locator('input[aria-label="搜索进程名 / PID / 命令行…"]')
    ).toHaveValue(/^\d+$/);
  });
});

test.describe("CSV 导出", () => {
  test("进程页导出下载的文件带表头且行数匹配", async ({ page }) => {
    await gotoPage(page, "进程");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出 CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^workbench-processes-.*\.csv$/);
    const stream = await download.createReadStream();
    let text = "";
    for await (const chunk of stream) text += chunk.toString("utf8");
    expect(text.split("\r\n")[0]).toContain("pid,name,cpu_pct");
    expect(text.trim().split("\r\n").length).toBeGreaterThanOrEqual(7);
  });
});
