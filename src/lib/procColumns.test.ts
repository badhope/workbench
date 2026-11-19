import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROC_COLUMNS,
  PROC_COLUMNS,
  moveProcColumn,
  sanitizeProcColumns,
  type ProcColumnId,
} from "./procColumns";

describe("procColumns", () => {
  it("默认显示全部列", () => {
    expect(DEFAULT_PROC_COLUMNS).toEqual(PROC_COLUMNS);
    expect(DEFAULT_PROC_COLUMNS).toHaveLength(8);
  });

  it("清洗未知列、重复列与空配置", () => {
    expect(sanitizeProcColumns(["cpu", "pid", "cpu", "ghost"])).toEqual(["cpu", "pid"]);
    expect(sanitizeProcColumns([])).toEqual(DEFAULT_PROC_COLUMNS);
    expect(sanitizeProcColumns("nope")).toEqual(DEFAULT_PROC_COLUMNS);
    expect(sanitizeProcColumns(undefined)).toEqual(DEFAULT_PROC_COLUMNS);
  });

  it("只保留已知列，不改变原数组", () => {
    const input = ["pid", "cpu"];
    expect(sanitizeProcColumns(input)).toEqual(input);
    expect(input).toEqual(["pid", "cpu"]);
  });

  it("上移/下移只在可见列内换位，越界不动", () => {
    const cols = ["pid", "cpu", "memory"] as const;
    expect(moveProcColumn([...cols], "cpu", -1)).toEqual(["cpu", "pid", "memory"]);
    expect(moveProcColumn([...cols], "cpu", 1)).toEqual(["pid", "memory", "cpu"]);
    expect(moveProcColumn([...cols], "pid", -1)).toEqual(["pid", "cpu", "memory"]);
    expect(moveProcColumn([...cols], "memory", 1)).toEqual(["pid", "cpu", "memory"]);
    expect(moveProcColumn([...cols], "nope" as ProcColumnId, 1)).toEqual([
      "pid",
      "cpu",
      "memory",
    ]);
  });
});
