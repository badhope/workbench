import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 开机自启包装层。
 *
 * 重点不是「调用了一次插件」，而是两个容易在真机上出错的分支：
 * 1) 浏览器预览（无 Tauri 宿主）必须完全不碰插件，否则页面一打开就抛错；
 * 2) 读取状态必须每次都问操作系统，不能读本地缓存。
 */
const isEnabled = vi.fn(async () => true);
const enable = vi.fn(async () => {});
const disable = vi.fn(async () => {});

vi.mock("@tauri-apps/plugin-autostart", () => ({ isEnabled, enable, disable }));

const api = await import("./autostart");

function setTauri(on: boolean) {
  const w = window as unknown as Record<string, unknown>;
  if (on) w.__TAURI_INTERNALS__ = {};
  else delete w.__TAURI_INTERNALS__;
}

afterEach(() => {
  vi.clearAllMocks();
  setTauri(false);
});

describe("autostart", () => {
  it("浏览器模式下读取返回 null 且不调用插件", async () => {
    setTauri(false);
    expect(await api.autostart.read()).toBeNull();
    expect(isEnabled).not.toHaveBeenCalled();
  });

  it("浏览器模式下写入返回 null 且不调用插件", async () => {
    expect(await api.autostart.write(true)).toBeNull();
    expect(enable).not.toHaveBeenCalled();
    expect(disable).not.toHaveBeenCalled();
  });

  it("桌面模式下读取走插件", async () => {
    setTauri(true);
    isEnabled.mockResolvedValueOnce(false);
    expect(await api.autostart.read()).toBe(false);
    expect(isEnabled).toHaveBeenCalledTimes(1);
  });

  it("开启与关闭分别调用 enable / disable", async () => {
    setTauri(true);
    expect(await api.autostart.write(true)).toBe(true);
    expect(enable).toHaveBeenCalledTimes(1);
    expect(await api.autostart.write(false)).toBe(false);
    expect(disable).toHaveBeenCalledTimes(1);
  });

  it("插件抛错时向上冒泡，由调用方回滚界面", async () => {
    setTauri(true);
    enable.mockRejectedValueOnce(new Error("拒绝访问"));
    await expect(api.autostart.write(true)).rejects.toThrow("拒绝访问");
  });
});
