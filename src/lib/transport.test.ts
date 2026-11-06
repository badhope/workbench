import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetTransportForTests,
  currentTransport,
  detectTransport,
  hasBackend,
  httpJson,
  subscribeTransport,
  transportResolved,
  HttpError,
} from "./transport";

/**
 * 传输层：决定「这页跑在桌面壳 / HTTP 后端 / 纯静态演示」。
 *
 * 这段逻辑值得单独测，因为它是三种运行形态的唯一分岔口：
 * 判错一次，用户要么看到假数据当成真的，要么真实功能全部静默失效。
 * 关键约束：
 * 1) 桌面判定是同步的（不依赖网络），首帧不能闪错；
 * 2) HTTP 探测只做一次，并发调用共享结果；
 * 3) 探测失败必须落到 demo，而不是抛错让页面白屏。
 */

const jsonResponse = (body: unknown, init: { ok?: boolean; status?: number } = {}) =>
  ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  }) as unknown as Response;

function setTauri(on: boolean) {
  const w = window as unknown as Record<string, unknown>;
  if (on) w.__TAURI_INTERNALS__ = {};
  else delete w.__TAURI_INTERNALS__;
}

afterEach(() => {
  __resetTransportForTests();
  setTauri(true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  __resetTransportForTests();
  setTauri(true);
});

describe("桌面判定", () => {
  it("有 __TAURI_INTERNALS__ 时同步判定为 tauri，且不发任何请求", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(currentTransport()).toBe("tauri");
    expect(transportResolved()).toBe(true);
    await expect(detectTransport()).resolves.toBe("tauri");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("hasBackend 在桌面端恒为真", () => {
    expect(hasBackend()).toBe(true);
  });
});

describe("HTTP 探测", () => {
  it("健康检查返回 status=ok 时判定为 http", async () => {
    setTauri(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ status: "ok" }))
    );

    await expect(detectTransport()).resolves.toBe("http");
    expect(currentTransport()).toBe("http");
    expect(hasBackend()).toBe(true);
  });

  it("健康检查返回 404 时退化为 demo（纯静态站点）", async () => {
    setTauri(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "not found" }, { ok: false, status: 404 }))
    );

    await expect(detectTransport()).resolves.toBe("demo");
    expect(currentTransport()).toBe("demo");
    expect(hasBackend()).toBe(false);
  });

  it("body 不是预期形状时也退化为 demo，不把任意 JSON 当成后端", async () => {
    setTauri(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ hello: "world" }))
    );

    await expect(detectTransport()).resolves.toBe("demo");
  });

  it("网络错误退化为 demo，不抛错", async () => {
    setTauri(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );

    await expect(detectTransport()).resolves.toBe("demo");
  });

  it("并发调用只发一次探测请求", async () => {
    setTauri(false);
    const spy = vi.fn(async () => jsonResponse({ status: "ok" }));
    vi.stubGlobal("fetch", spy);

    const [a, b, c] = await Promise.all([
      detectTransport(),
      detectTransport(),
      detectTransport(),
    ]);
    expect([a, b, c]).toEqual(["http", "http", "http"]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("探测完成后广播订阅者，让模式徽章更新", async () => {
    setTauri(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ status: "ok" }))
    );

    let notified = 0;
    const off = subscribeTransport(() => {
      notified += 1;
    });
    await detectTransport();

    expect(notified).toBeGreaterThanOrEqual(1);
    // 退订后不再收到通知
    off();
    const before = notified;
    __resetTransportForTests();
    expect(notified).toBe(before);
  });

  it("探测完成前 transportResolved 为 false", () => {
    setTauri(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {}))
    );
    expect(transportResolved()).toBe(false);
  });
});

describe("httpJson", () => {
  it("GET 成功返回解析后的 JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: 1 }))
    );
    await expect(httpJson<{ ok: number }>("/api/x")).resolves.toEqual({ ok: 1 });
  });

  it("带 body 时设置 content-type 并序列化", async () => {
    const spy = vi.fn(async (..._args: unknown[]) => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", spy);
    await httpJson("/api/data", { method: "PUT", body: { a: 1 } });

    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Record<string, string>)["content-type"]).toBe(
      "application/json"
    );
  });

  it("后端返回 {error} 时抛出带该消息的 HttpError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: "数据文件损坏" }, { ok: false, status: 500 })
      )
    );

    await expect(httpJson("/api/data")).rejects.toBeInstanceOf(HttpError);
    await expect(httpJson("/api/data")).rejects.toThrow("数据文件损坏");
  });

  it("响应不是 JSON 时退回状态码文本，不把 HTML 整段塞进错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 502,
            json: async () => {
              throw new SyntaxError("Unexpected token <");
            },
          }) as unknown as Response
      )
    );

    await expect(httpJson("/api/x")).rejects.toThrow("HTTP 502");
  });
});

describe("能力判定", () => {
  it("isDesktop 只在 tauri 时为真", async () => {
    const { isDesktop } = await import("./transport");
    expect(isDesktop()).toBe(true); // 默认是桌面环境

    setTauri(false);
    __resetTransportForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ status: "ok" }))
    );
    await detectTransport();
    expect(isDesktop()).toBe(false);
  });

  it("HTTP 后端下 hasBackend 为真但 isDesktop 为假（区分数据与原生能力）", async () => {
    const { isDesktop } = await import("./transport");
    setTauri(false);
    __resetTransportForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ status: "ok" }))
    );
    await detectTransport();
    expect(hasBackend()).toBe(true);
    expect(isDesktop()).toBe(false);
  });
});
