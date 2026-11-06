import { describe, expect, it } from "vitest";
import { classifyOpenTarget, isUrlScheme, urlForPort } from "./openTarget";

/**
 * 回归：openExternal 曾用 `/^[a-z][a-z0-9+.-]*:/` 判 scheme，
 * 把 `C:\proj` 当成了 scheme，导致项目页 / 服务器页的「打开目录」
 * 全部抛错且无人 catch —— 点击后界面毫无反应。
 */
describe("Windows 路径不能被当作 URL scheme", () => {
  it.each([
    ["C:\\proj\\shop-web", "盘符反斜杠"],
    ["C:/proj/shop-web", "盘符正斜杠"],
    ["D:\\work", "其它盘符"],
    ["c:\\lower", "小写盘符"],
    ["\\\\server\\share", "UNC"],
    ["//server/share", "UNC 正斜杠"],
  ])("%s（%s）识别为 path", (target) => {
    expect(classifyOpenTarget(target)).toEqual({ kind: "path", value: target });
    expect(isUrlScheme(target)).toBe(false);
  });

  it("裸盘符 C: 也不是 scheme", () => {
    expect(isUrlScheme("C:")).toBe(false);
    expect(classifyOpenTarget("C:")).toEqual({ kind: "path", value: "C:" });
  });
});

describe("真正的 URL scheme", () => {
  it("http/https 交给浏览器", () => {
    expect(classifyOpenTarget("http://localhost:5173")).toEqual({
      kind: "http",
      value: "http://localhost:5173",
    });
    expect(classifyOpenTarget("HTTPS://example.com")).toEqual({
      kind: "http",
      value: "HTTPS://example.com",
    });
  });

  it.each(["file:///C:/Windows", "ms-msdt:/id", "mailto:a@b.c", "javascript:alert(1)"])(
    "%s 被拒绝",
    (target) => {
      expect(classifyOpenTarget(target).kind).toBe("unsupported");
    }
  );

  it("保留 scheme 名便于提示", () => {
    expect(classifyOpenTarget("file:///C:/Windows")).toEqual({
      kind: "unsupported",
      scheme: "file",
    });
  });
});

describe("边界输入", () => {
  it("空白串返回 empty", () => {
    expect(classifyOpenTarget("")).toEqual({ kind: "empty" });
    expect(classifyOpenTarget("   ")).toEqual({ kind: "empty" });
  });

  it("两端空白被裁剪", () => {
    expect(classifyOpenTarget("  C:\\proj  ")).toEqual({
      kind: "path",
      value: "C:\\proj",
    });
  });

  it("相对路径按 path 处理（由后端白名单决定是否放行）", () => {
    expect(classifyOpenTarget("proj/sub")).toEqual({ kind: "path", value: "proj/sub" });
  });
});

/**
 * 端口 → URL 的推断规则。
 *
 * 这段逻辑替代了原先写死的 `http://localhost:${port}`：后者在
 * IPv6 监听、HTTPS 服务、UDP 端口上都会给出错误链接。
 */
describe("urlForPort", () => {
  it("通配监听地址回落到 localhost", () => {
    expect(urlForPort(3000, "0.0.0.0", "TCP")?.url).toBe("http://localhost:3000");
    expect(urlForPort(3000, "::", "TCP")?.url).toBe("http://localhost:3000");
  });

  it("具体地址原样使用", () => {
    expect(urlForPort(8080, "127.0.0.1", "TCP")?.url).toBe("http://127.0.0.1:8080");
    expect(urlForPort(8080, "192.168.1.5", "TCP")?.url).toBe("http://192.168.1.5:8080");
  });

  it("IPv6 字面量加方括号，否则 URL 解析会失败", () => {
    expect(urlForPort(5173, "::1", "TCP")?.url).toBe("http://[::1]:5173");
  });

  it("常见 TLS 端口推断为 https", () => {
    expect(urlForPort(443, "127.0.0.1", "TCP")?.url).toBe("https://127.0.0.1:443");
    expect(urlForPort(8443, "127.0.0.1", "TCP")?.url).toBe("https://127.0.0.1:8443");
    expect(urlForPort(3000, "127.0.0.1", "TCP")?.url).toBe("http://127.0.0.1:3000");
  });

  it("UDP 与非法端口不产生链接", () => {
    expect(urlForPort(53, "0.0.0.0", "UDP")).toBeNull();
    expect(urlForPort(0, "0.0.0.0", "TCP")).toBeNull();
    expect(urlForPort(70000, "0.0.0.0", "TCP")).toBeNull();
    expect(urlForPort(1.5, "0.0.0.0", "TCP")).toBeNull();
  });
});
