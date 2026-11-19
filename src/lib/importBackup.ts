/**
 * 备份导入校验：外部 JSON 整份校验后才允许落库。
 *
 * 拆出 Settings.tsx 的原因：原 `parseBackup` 圈复杂度 32（项目红线 10）。
 * 这里按「顶层结构 → 版本 → 项目字段 → 任务字段」分层，每层独立可测；
 * 任一字段不合规就整份拒绝，并给出具体原因。
 */
import type { WorkbenchData } from "../types";

/** 当前数据结构版本，必须与 Rust 侧 data.rs 的 SCHEMA_VERSION 保持一致。 */
export const MAX_SCHEMA_VERSION = 2;

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isUint = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isOptionalString = (value: unknown) =>
  value === undefined || value === null || typeof value === "string";

const isOptionalUint = (value: unknown) =>
  value === undefined || value === null || isUint(value);

function assertSupportedVersion(value: unknown, t: Translate): void {
  // 缺失 schema_version 就是 v1；比当前版本新就拒绝，避免把未知字段
  // 悄悄丢掉再写回磁盘，覆盖掉用户在新版里填的内容。
  if (value === undefined) return;
  if (!isUint(value) || value < 1) {
    throw new Error(t("settings.importBadStructure"));
  }
  if (value > MAX_SCHEMA_VERSION) {
    throw new Error(t("settings.importNewerVersion", { version: value }));
  }
}

function assertProject(value: unknown, t: Translate): void {
  const p = value as Partial<WorkbenchData["projects"][number]> | null;
  if (
    !p ||
    typeof p.id !== "string" ||
    typeof p.name !== "string" ||
    typeof p.path !== "string" ||
    typeof p.status !== "string" ||
    !isStringArray(p.tags) ||
    typeof p.pinned !== "boolean" ||
    typeof p.note !== "string" ||
    !isOptionalString(p.goal) ||
    !isUint(p.created_at)
  ) {
    throw new Error(t("settings.importBadProject"));
  }
}

function assertTask(value: unknown, t: Translate): void {
  const task = value as Partial<WorkbenchData["tasks"][number]> | null;
  if (
    !task ||
    typeof task.id !== "string" ||
    typeof task.title !== "string" ||
    typeof task.priority !== "string" ||
    !isStringArray(task.tags) ||
    !isUint(task.created_at) ||
    !isUint(task.updated_at) ||
    !isOptionalString(task.next_step) ||
    !isOptionalString(task.blocked_reason) ||
    !isOptionalUint(task.completed_at) ||
    (task.due !== null && task.due !== undefined && typeof task.due !== "string") ||
    (task.project_id !== null &&
      task.project_id !== undefined &&
      typeof task.project_id !== "string")
  ) {
    throw new Error(t("settings.importBadTask"));
  }
  if (!["todo", "doing", "done"].includes(String(task.status))) {
    throw new Error(t("settings.importBadStatus"));
  }
}

/** 解析并校验备份文本；失败抛出的 Error.message 已是可展示的本地化文案。 */
export function parseBackup(text: string, t: Translate): WorkbenchData {
  const parsed = JSON.parse(text) as WorkbenchData;
  if (!Array.isArray(parsed.projects) || !Array.isArray(parsed.tasks)) {
    throw new Error(t("settings.importBadStructure"));
  }
  assertSupportedVersion(parsed.schema_version, t);
  for (const project of parsed.projects) assertProject(project, t);
  for (const task of parsed.tasks) assertTask(task, t);
  return parsed;
}
