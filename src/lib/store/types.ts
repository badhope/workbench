import type { ThemeInput } from "../theme/tokens";
import type { MotionLevel } from "../theme/apply";
import type { OverviewLayoutId, ShellId, WidgetId } from "../layout";
import type { WorkMode } from "../workModes";
import type { TaskScope } from "../workbench";
import type {
  AiProcess,
  CostOverview,
  CostSettings,
  CostTrendRow,
  DevServer,
  DiskInfo,
  ModelBreakdownRow,
  CostMonthRow,
  ProjectBreakdownRow,
  OpencodeSession,
  PortEntry,
  ProcInfo,
  Project,
  SessionDetail,
  SessionFilePreview,
  SystemInfo,
  Task,
  ViewKey,
  WorkbenchData,
  RestoreResult,
} from "../../types";

export type ProcView = "flat" | "tree";

export interface UiState {
  /** 当前主题 id（内置或用户自建） */
  theme: string;
  /** 用户自建主题（内置主题不存这里，升级时自动获得新内置主题） */
  customThemes: ThemeInput[];
  /**
   * 动效档位：off / standard / rich。
   * 注意「设置的档位」≠「生效的档位」：生效值见 effectiveMotion()。
   */
  motion: MotionLevel;
  /**
   * 用户是否显式选过档位。
   * false 时系统 prefers-reduced-motion 会把生效档压成 off；
   * true 时用户的显式选择优先（「允许覆盖系统设置」的语义）。
   */
  motionExplicit: boolean;
  /** 首启 3 步引导是否已完成/跳过（true 后永不复弹） */
  onboardingDone: boolean;
  /**
   * 用户选择的工作方式（多选）。空数组 = 尚未选择；
   * 只影响默认呈现，不锁定功能、不改变权限。
   */
  workModes: WorkMode[];
  /** 是否已经明确选择过工作方式（用于设置页与首启判断）。 */
  workModeChosen: boolean;
  /**
   * 氛围粒子背景。默认关（省电）；开启后仍受双重约束：
   * 生效动效档为 off 时停用、页面隐藏时自动暂停（见 ParticleBackdrop）。
   */
  particles: boolean;
  /** 粒子氛围强度 0-100（默认 65：看得见但不吵） */
  particlesIntensity: number;
  /**
   * 自定义背景图（dataURL，仅存本机）。写入前必须经
   * isBackgroundDataUrl 校验——只接受 data:image/*，其它一律拒收。
   */
  backgroundImage: string | null;
  /** 外壳：侧栏 / 顶部坞 / 专注 */
  shell: ShellId;
  /** 概览页布局 */
  layout: OverviewLayoutId;
  /** 概览页组件顺序 */
  widgetOrder: WidgetId[];
  /** 概览页隐藏的组件 */
  widgetHidden: WidgetId[];
  /** 用户覆盖的组件宽度（缺省 = 组件自带 span） */
  widgetSpans: Partial<Record<WidgetId, number>>;
  /** 进程页视图：扁平列表 / 父子树 */
  procView: ProcView;
  /** 任务页视图：列表优先，看板是第二视图 */
  taskView: "list" | "board";
  /** 任务页范围：全部 / 今天 / 本周 / 收件箱 */
  taskScope: TaskScope;
  /** 任务页项目筛选；空字符串 = 全部项目 */
  taskProjectFilter: string;
  /** 首页右栏是否收起 */
  railCollapsed: boolean;
  /** 首页右栏各分区是否显示 */
  railSections: { projects: boolean; inbox: boolean; system: boolean };
  /** 全局侧边栏是否折叠为图标条（shell=rail 时生效） */
  navCollapsed: boolean;
  /** 进程页搜索词。放在 store 里是因为端口页/命令面板要能带着 PID 跳过来。 */
  procQuery: string;
  /** 跳转后要高亮的进程 PID（一次性） */
  focusPid: number | null;
  refreshMs: number;
  view: ViewKey;
  /** 当前打开的任务详情；null = 关闭。仅内存态，不跨启动恢复。 */
  taskDetailId: string | null;
  alwaysOnTop: boolean;
}

export interface RuntimeState {
  procs: ProcInfo[];
  ports: PortEntry[];
  devs: DevServer[];
  ais: AiProcess[];
  sessions: OpencodeSession[];
  opencodePort: number;
  sessionsErr: string;
  sessionFiles: SessionFilePreview[];
  sessionFilesErr: string;
  sessionDetail: SessionDetail | null;
  sessionDetailLoading: boolean;
  sysinfo: SystemInfo | null;
  disks: DiskInfo[];
  gitBranches: Record<string, string>;
  loading: boolean;
  /** 最近一次运行时采集的失败原因；成功时清空。
   *  与 toast 并存：toast 会消失，页面内联错误态需要持久状态。 */
  runtimeError: string;
  /** 项目/任务数据读取失败的原因；非空时应用显示持久错误横幅。 */
  dataLoadError: string;
  lastRefreshAt: number;
  /** 最近一次工作数据（项目/任务）载入或本地修改的时间；与运行时采集分开。 */
  lastDataUpdatedAt: number;
  history: { cpu: number; memGb: number; t: number }[];
  // ── 成本计量 ──
  costOverview: CostOverview | null;
  costTrend: CostTrendRow[];
  costModelBreakdown: ModelBreakdownRow[];
  /** 按项目目录归因的成本（"哪个仓库花钱最多"） */
  costProjectBreakdown: ProjectBreakdownRow[];
  /** 超出日粒度窗口的月度聚合桶（升序，可拼在日粒度前） */
  costTrendMonthly: CostMonthRow[];
  /** 趋势窗口天数；>30 时旧数据由后端按月聚合 */
  costTrendDays: number;
  costSettings: CostSettings;
  costLoading: boolean;
  costNotified: boolean; // 是否已发过预算告警通知（避免重复打扰）
}

export interface Store extends UiState, RuntimeState {
  data: WorkbenchData;
  toast: string;
  killTarget: ProcInfo | null;
  setView: (v: ViewKey) => void;
  /** 打开/关闭任务详情（传 null 关闭）。 */
  setTaskDetailId: (id: string | null) => void;
  setTheme: (id: string) => void;
  /** 设置动效档位（视为用户显式选择，覆盖系统 reduced-motion） */
  setMotion: (m: MotionLevel) => void;
  /** 完成或跳过首启引导（二者同义：都永久关闭） */
  setOnboardingDone: () => void;
  /** 设置工作方式（多选）；空数组视为尚未选择。 */
  setWorkModes: (modes: WorkMode[]) => void;
  /** 标记用户已明确选择工作方式。 */
  setWorkModeChosen: (chosen: boolean) => void;
  setTaskView: (v: "list" | "board") => void;
  setTaskScope: (v: TaskScope) => void;
  setTaskProjectFilter: (id: string) => void;
  setRailCollapsed: (v: boolean) => void;
  setNavCollapsed: (v: boolean) => void;
  setRailSection: (key: keyof UiState["railSections"], v: boolean) => void;
  resetRailSections: () => void;
  /** 开关氛围粒子背景 */
  setParticles: (v: boolean) => void;
  /** 设置粒子氛围强度 0-100（自动钳制取整） */
  setParticlesIntensity: (v: number) => void;
  /** 设置/清除自定义背景图（调用方负责先压缩与校验） */
  setBackground: (dataUrl: string | null) => void;
  /** 新建/覆盖一个自定义主题；返回它的 id */
  upsertTheme: (theme: ThemeInput) => string;
  deleteTheme: (id: string) => void;
  importTheme: (json: string) => { ok: boolean; error?: string; id?: string };
  setShell: (s: ShellId) => void;
  setLayout: (l: OverviewLayoutId) => void;
  setWidgetOrder: (o: WidgetId[]) => void;
  setWidgetHidden: (h: WidgetId[]) => void;
  setWidgetSpan: (id: WidgetId, span: number) => void;
  resetWidgets: () => void;
  setProcView: (v: ProcView) => void;
  setProcQuery: (q: string) => void;
  setFocusPid: (pid: number | null) => void;
  setRefreshMs: (ms: number) => void;
  setToast: (t: string) => void;
  clearToast: () => void;
  setKillTarget: (p: ProcInfo | null) => void;
  setAlwaysOnTop: (v: boolean) => void;
  loadAll: () => Promise<void>;
  /** 只重读项目/任务数据（窗口聚焦、定时同步、跨窗口通知用）。 */
  refreshData: () => Promise<void>;
  refreshRuntime: () => Promise<void>;
  refreshAi: () => Promise<void>;
  loadSessionDetail: (port: number, id: string) => Promise<void>;
  fetchGitBranch: (dir: string) => Promise<string>;
  openTarget: (target: string) => Promise<void>;
  killProcess: (target: Pick<ProcInfo, "pid" | "name" | "start_time">) => Promise<void>;
  addTask: (t: Partial<Task>) => boolean;
  moveTask: (id: string, status: string) => boolean;
  updateTask: (id: string, patch: Partial<Task>) => boolean;
  deleteTask: (id: string) => void;
  addProject: (p: Partial<Project>) => boolean;
  updateProject: (id: string, patch: Partial<Project>) => boolean;
  deleteProject: (id: string) => void;
  persistData: (next: WorkbenchData) => boolean;
  persistDataNow: (next: WorkbenchData) => Promise<boolean>;
  discardUnsavedAndReload: () => Promise<void>;
  backupCurrentData: () => ReturnType<typeof import("../api").backupData>;
  restoreData: (id: string) => Promise<RestoreResult>;
  // ── 成本计量 ──
  loadCostOverview: () => Promise<string | undefined>;
  /** 按天数窗口重取趋势（>30 天时旧数据按月聚合）。 */
  loadCostTrend: (days: number) => Promise<void>;
  scanCosts: (options?: { afterCurrent?: boolean }) => Promise<void>;
  loadCostSettings: () => Promise<void>;
  updateCostSettings: (s: CostSettings) => Promise<boolean>;
  clearCosts: () => Promise<void>;
  checkBudgetAlert: () => void;
}

export type StoreSet = (
  partial: Partial<Store> | ((state: Store) => Partial<Store>)
) => void;
export type StoreGet = () => Store;
