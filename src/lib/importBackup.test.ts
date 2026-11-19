import { describe, expect, it } from "vitest";
import { parseBackup } from "./importBackup";

const t = (key: string) => key;

const project = {
  id: "p1",
  name: "workbench",
  path: "/tmp/workbench",
  status: "active",
  tags: ["rust"],
  pinned: false,
  note: "",
  goal: null,
  created_at: 1,
};

const task = {
  id: "t1",
  title: "修 P0",
  status: "todo",
  priority: "high",
  tags: [],
  created_at: 1,
  updated_at: 1,
  next_step: null,
  blocked_reason: null,
  completed_at: null,
  due: null,
  project_id: "p1",
};

const valid = { schema_version: 2, projects: [project], tasks: [task] };

describe("parseBackup", () => {
  it("接受完整合法的备份", () => {
    expect(parseBackup(JSON.stringify(valid), t).projects).toHaveLength(1);
  });

  it("拒绝缺少顶层数组的结构", () => {
    expect(() => parseBackup(JSON.stringify({ projects: [] }), t)).toThrow(
      "settings.importBadStructure"
    );
  });

  it("拒绝字段缺失的项目与非法任务状态", () => {
    expect(() =>
      parseBackup(JSON.stringify({ ...valid, projects: [{ id: "p1" }] }), t)
    ).toThrow("settings.importBadProject");
    expect(() =>
      parseBackup(
        JSON.stringify({ ...valid, tasks: [{ ...task, status: "unknown" }] }),
        t
      )
    ).toThrow("settings.importBadStatus");
  });

  it("拒绝比当前 schema 更新的备份，避免静默丢字段", () => {
    expect(() => parseBackup(JSON.stringify({ ...valid, schema_version: 3 }), t)).toThrow(
      "settings.importNewerVersion"
    );
  });
});
