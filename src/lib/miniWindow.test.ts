import { afterEach, describe, expect, it, vi } from "vitest";
import { miniWindowUrl, openMiniWindow } from "./miniWindow";
import * as api from "./api";

/**
 * 小窗入口的三条分支：桌面 IPC 成功、IPC 失败退回 window.open、纯浏览器预览。
 * 最后一条最容易坏——桌面命令不存在时按钮不能变成「点了没反应」。
 */
describe("miniWindowUrl", () => {
  it("adds mini=1 while keeping the current path and existing params", () => {
    window.history.pushState({}, "", "/index.html?lang=zh");
    const url = new URL(miniWindowUrl());
    expect(url.searchParams.get("mini")).toBe("1");
    expect(url.searchParams.get("lang")).toBe("zh");
    expect(url.pathname).toBe("/index.html");
  });

  it("does not duplicate the flag when already set", () => {
    window.history.pushState({}, "", "/index.html?mini=1");
    const url = new URL(miniWindowUrl());
    expect(url.searchParams.getAll("mini")).toEqual(["1"]);
  });
});

describe("openMiniWindow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the desktop command when available", async () => {
    const ipc = vi.spyOn(api, "openMiniWindow").mockResolvedValue(undefined);
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    vi.spyOn(api, "isTauri").mockReturnValue(true);

    await openMiniWindow();

    expect(ipc).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it("falls back to window.open when the desktop command fails", async () => {
    vi.spyOn(api, "openMiniWindow").mockRejectedValue(new Error("no ipc"));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    vi.spyOn(api, "isTauri").mockReturnValue(true);

    await openMiniWindow();

    expect(open).toHaveBeenCalledTimes(1);
    const [url, target] = open.mock.calls[0];
    expect(String(url)).toContain("mini=1");
    expect(target).toBe("workbench-mini");
  });

  it("opens a browser popup in preview mode without touching IPC", async () => {
    const ipc = vi.spyOn(api, "openMiniWindow");
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    vi.spyOn(api, "isTauri").mockReturnValue(false);

    await openMiniWindow();

    expect(ipc).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
  });
});
