import { describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import {
  dueLabel,
  formatBytes,
  formatCpu,
  formatDateTime,
  formatDuration,
  formatTokens,
  formatTime,
  formatUsd,
  formatUptime,
  shortPath,
} from "./util";

// 锁定界面语言：日期/时长文案按中文断言（默认语言是英语）
setLang("zh");

describe("formatBytes", () => {
  it("0 与负值显示 0 B", () => {
    expect(formatBytes(0)).toBe("0 B");
  });
  it("各单位边界", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GB");
    expect(formatBytes(1024 ** 4)).toBe("1.0 TB");
  });
  it("大数不显示小数", () => {
    expect(formatBytes(200 * 1024 ** 3)).toBe("200 GB");
  });
  it("数字按界面语言分组（Intl.NumberFormat）", () => {
    expect(formatBytes(1000 * 1024 ** 4, "en")).toBe("1,000 TB");
  });
});

describe("formatDateTime", () => {
  const at = Date.UTC(2026, 10, 20, 12, 0, 0);

  it("英文、中文、日文各自使用本地日期顺序", () => {
    expect(formatDateTime(at, "en")).toContain("Nov 20, 2026");
    expect(formatDateTime(at, "zh")).toContain("2026年11月20日");
    expect(formatDateTime(at, "ja")).toContain("2026/11/20");
  });

  it("非法值与空值返回占位", () => {
    expect(formatDateTime(0)).toBe("-");
    expect(formatDateTime("not-a-date")).toBe("-");
    expect(formatDateTime(new Date(Number.NaN))).toBe("-");
  });
});

describe("formatCpu", () => {
  it("保留一位小数", () => {
    expect(formatCpu(12.34)).toBe("12.3%");
  });
});

describe("formatUsd", () => {
  it("零与非法值", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(-1)).toBe("$0.00");
    expect(formatUsd(Infinity)).toBe("$0.00");
  });
  it("小于 1 美分显示 4 位小数", () => {
    expect(formatUsd(0.001)).toBe("$0.0010");
  });
  it("小于 1 美元显示 3 位", () => {
    expect(formatUsd(0.5)).toBe("$0.500");
  });
  it("正常金额 2 位", () => {
    expect(formatUsd(12.5)).toBe("$12.50");
  });
});

describe("formatTokens", () => {
  it("K/M 缩写", () => {
    expect(formatTokens(890)).toBe("890");
    expect(formatTokens(12_345)).toBe("12.3K");
    expect(formatTokens(1_234_567)).toBe("1.23M");
  });
  it("非正数归零", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(-5)).toBe("0");
  });
});

describe("formatDuration / formatUptime", () => {
  it("时长组合", () => {
    expect(formatDuration(0)).toBe("< 1 分钟");
    expect(formatDuration(45)).toBe("45秒");
    expect(formatDuration(600)).toBe("10分钟");
    expect(formatDuration(8100)).toBe("2小时15分");
  });
  it("运行时间带天", () => {
    expect(formatUptime(86400 * 2 + 3600 * 3)).toBe("2 天 3 小时");
    expect(formatUptime(0)).toBe("-");
  });
});

describe("dueLabel", () => {
  it("空截止日期", () => {
    expect(dueLabel(null)).toEqual({ text: "无期限", tone: "dim" });
  });
  it("非法日期原样返回", () => {
    expect(dueLabel("not-a-date")).toEqual({ text: "not-a-date", tone: "dim" });
  });
  // 回归：用 toISOString()（UTC）生成「今天」在东八区凌晨会得到昨天，
  // 导致当天截止被误判为逾期。日期必须按本地日历日生成与比较。
  it("今天与近期按本地日历日判定", () => {
    const localToday = [
      new Date().getFullYear(),
      String(new Date().getMonth() + 1).padStart(2, "0"),
      String(new Date().getDate()).padStart(2, "0"),
    ].join("-");
    expect(dueLabel(localToday).text).toBe("今天");
    expect(dueLabel(localToday).tone).toBe("warn");
  });
});

describe("shortPath / formatTime", () => {
  it("超长路径截断且保留尾部", () => {
    const p = "C:\\" + "very-long\\".repeat(10) + "file.txt";
    const got = shortPath(p, 20);
    expect(got.startsWith("…")).toBe(true);
    expect(got.endsWith("file.txt")).toBe(true);
  });
  it("空值返回占位", () => {
    expect(shortPath(null)).toBe("-");
    expect(formatTime(0)).toBe("-");
  });
});
