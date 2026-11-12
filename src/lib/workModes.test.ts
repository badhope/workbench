import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORK_MODES,
  normalizeWorkModes,
  showsProjectsPanel,
  showsToolsSummary,
  toggleWorkMode,
} from "./workModes";

describe("工作方式归一化", () => {
  it("丢弃未知值并去重", () => {
    expect(normalizeWorkModes(["development", "ghost", "development"])).toEqual([
      "development",
    ]);
  });

  it("非数组回退为空数组", () => {
    expect(normalizeWorkModes(undefined)).toEqual([]);
    expect(normalizeWorkModes("development")).toEqual([]);
  });

  it("custom 与具体工作方式互斥", () => {
    expect(normalizeWorkModes(["custom", "development"])).toEqual(["custom"]);
  });

  it("toggle 选择 custom 时清空其他项", () => {
    expect(toggleWorkMode(["development"], "custom")).toEqual(["custom"]);
  });

  it("toggle 选择具体项时移除 custom", () => {
    expect(toggleWorkMode(["custom"], "project")).toEqual(["project"]);
  });

  it("再次点击同一项会取消", () => {
    expect(toggleWorkMode(["development"], "development")).toEqual([]);
  });
});

describe("首页呈现规则", () => {
  it("开发模式显示工具摘要", () => {
    expect(showsToolsSummary(["development"])).toBe(true);
    expect(showsToolsSummary(["project"])).toBe(false);
  });

  it("个人模式默认不展示项目面板，但自由配置展示", () => {
    expect(showsProjectsPanel(["personal"])).toBe(false);
    expect(showsProjectsPanel(["personal", "custom"])).toBe(true);
    expect(showsProjectsPanel(DEFAULT_WORK_MODES)).toBe(true);
  });

  it("尚未选择时保持完整工作台，不隐藏内容", () => {
    expect(showsProjectsPanel([])).toBe(true);
  });
});
