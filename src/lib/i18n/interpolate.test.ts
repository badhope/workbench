import { afterEach, describe, expect, it } from "vitest";
import { localeFor, setLang, subscribeLang, t } from "./index";

/**
 * 插值的边界行为。变量值来自错误信息、路径、进程名 —— 这些内容里
 * 出现 `$&` 或花括号并不罕见，字符串形式的 replaceAll 会把它们当替换模式解析。
 */
describe("t() 插值", () => {
  it("普通占位符被替换", () => {
    expect(t("store.killSent", { pid: 123 }, "zh")).toBe("已发送终止信号给进程 123");
  });

  it("变量值里的 $& 与 $$ 原样保留", () => {
    // 字符串形式下 $& 会被展开成匹配到的 {err}，$$ 折叠成 $
    const out = t("store.saveFailed", { err: "C:\\x $& y $$ z" }, "zh");
    expect(out).toBe("保存失败: C:\\x $& y $$ z");
  });

  it("变量值里含其它占位符时不会被二次替换", () => {
    // 先替换 {err}，其值含有 {pid}；若用字符串替换，后续 {pid} 会被一起吃掉
    const out = t("store.killFailed", { err: "pid={pid}" }, "zh");
    expect(out).toBe("终止失败: pid={pid}");
  });

  it("未提供的占位符保持原样", () => {
    expect(t("store.killSent", {}, "zh")).toBe("已发送终止信号给进程 {pid}");
  });

  it("未知 key 回退为 key 本身（三级回退的最后一级）", () => {
    expect(t("totally.unknown.key", undefined, "zh")).toBe("totally.unknown.key");
  });
});

/**
 * 语言切换与词条回退：设置页切语言靠 setLang，
 * 而 store 等非组件模块直接吃 t()，两条路径必须同步。
 */
describe("语言状态", () => {
  afterEach(() => {
    setLang("zh");
  });

  it("setLang 切换后 t 立刻用新词典", () => {
    setLang("en");
    expect(t("app.mode.realtime")).toBe("Live");
    setLang("ja");
    expect(t("app.mode.realtime")).toBe("ライブ");
  });

  it("缺词条时回退英语，再回退 key 本身", () => {
    // 不存在的 key：返回 key，绝不返回空串
    expect(t("definitely.not.a.key")).toBe("definitely.not.a.key");
  });

  it("setLang 同步 <html lang> 并把选择写进 localStorage", () => {
    setLang("ja");
    expect(document.documentElement.lang).toBe("ja-JP");
    expect(localStorage.getItem("workbench-lang")).toBe("ja");
  });

  it("重复设置同一语言不会重复通知订阅者", () => {
    setLang("zh");
    let calls = 0;
    const off = subscribeLang(() => {
      calls += 1;
    });
    setLang("zh");
    expect(calls).toBe(0);
    setLang("en");
    expect(calls).toBe(1);
    off();
    setLang("zh");
    expect(calls).toBe(1);
  });

  it("localeFor 覆盖三语，其余落到 en-US", () => {
    expect(localeFor("zh")).toBe("zh-CN");
    expect(localeFor("ja")).toBe("ja-JP");
    expect(localeFor("en")).toBe("en-US");
  });

  it("三种语言的关键词条都不为空", () => {
    for (const lang of ["en", "zh", "ja"] as const) {
      for (const key of ["app.mode.realtime", "app.mode.web", "app.mode.demo"]) {
        const value = t(key, undefined, lang);
        expect(value.length, `${lang}/${key}`).toBeGreaterThan(0);
        expect(value).not.toBe(key);
      }
    }
  });
});
