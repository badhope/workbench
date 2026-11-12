/**
 * 工作方式（身份）预设。
 *
 * 设计约束：
 * - 这是「用户希望工作台怎么帮自己」的多选，不是职业标签，也不锁定功能；
 *   用户随时可以在设置里更改。
 * - 预设只改变默认呈现（例如是否把服务/AI 摘要放到首页），
 *   不改变权限、不自动开启敏感扫描。
 * - 所有值都必须可被旧数据/脏数据安全归一化：未知值丢弃、去重、custom 互斥。
 */

export type WorkMode =
  | "development"
  | "project"
  | "content"
  | "research"
  | "personal"
  | "custom";

export interface WorkModeDef {
  id: WorkMode;
  labelKey: string;
  hintKey: string;
}

/** 顺序即首次选择页的展示顺序。 */
export const WORK_MODES: WorkModeDef[] = [
  {
    id: "development",
    labelKey: "workMode.development",
    hintKey: "workMode.developmentHint",
  },
  { id: "project", labelKey: "workMode.project", hintKey: "workMode.projectHint" },
  { id: "content", labelKey: "workMode.content", hintKey: "workMode.contentHint" },
  { id: "research", labelKey: "workMode.research", hintKey: "workMode.researchHint" },
  { id: "personal", labelKey: "workMode.personal", hintKey: "workMode.personalHint" },
  { id: "custom", labelKey: "workMode.custom", hintKey: "workMode.customHint" },
];

export const DEFAULT_WORK_MODES: WorkMode[] = ["development", "project"];

const WORK_MODE_IDS = new Set<string>(WORK_MODES.map((m) => m.id));

export function isWorkMode(v: unknown): v is WorkMode {
  return typeof v === "string" && WORK_MODE_IDS.has(v);
}

/**
 * 归一化：只接受已知值，去重；custom 是「自由配置」，与其他项互斥。
 * 空数组是合法状态（用户尚未选择），由调用方决定是否补默认值。
 */
export function normalizeWorkModes(v: unknown): WorkMode[] {
  if (!Array.isArray(v)) return [];
  const unique = [...new Set(v.filter(isWorkMode))];
  if (unique.includes("custom")) return ["custom"];
  return unique;
}

/** 勾选/取消一项，并处理 custom 的互斥语义。 */
export function toggleWorkMode(current: WorkMode[], id: WorkMode): WorkMode[] {
  if (id === "custom") return current.includes("custom") ? [] : ["custom"];
  const withoutCustom = current.filter((m) => m !== "custom");
  return withoutCustom.includes(id)
    ? withoutCustom.filter((m) => m !== id)
    : [...withoutCustom, id];
}

/** 首页是否展示「工具/系统」摘要。 */
export function showsToolsSummary(modes: WorkMode[]): boolean {
  return modes.includes("development") || modes.includes("custom");
}

/** 首页是否展示项目面板。个人事务模式默认不需要，但侧栏仍可进入项目。 */
export function showsProjectsPanel(modes: WorkMode[]): boolean {
  if (modes.includes("custom")) return true;
  if (modes.length === 0) return true;
  return modes.some((m) => m !== "personal");
}
