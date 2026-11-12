import { create } from "zustand";
import {
  BUILTIN_THEMES,
  DEFAULT_THEME_ID,
  allThemes,
  migrateThemeId,
  parseTheme,
  tokensFor,
} from "./theme/presets";
import type { ThemeInput } from "./theme/tokens";
import { applyMotion, applyTheme, type MotionLevel } from "./theme/apply";
import { currentTransport, detectTransport } from "./transport";
import {
  DEFAULT_ORDER,
  normalizeHidden,
  normalizeLayout,
  normalizeOrder,
  normalizeShell,
  normalizeSpans,
  type OverviewLayoutId,
  type ShellId,
  type WidgetId,
} from "./layout";
import { getLang, t } from "./i18n";
import {
  DEFAULT_WORK_MODES,
  normalizeWorkModes,
  type WorkMode,
} from "./workModes";
import type { TaskScope } from "./workbench";
import { persist } from "zustand/middleware";
import {
  backupData,
  clearCostRecords,
  getCostOverview,
  getCostSettings,
  getCostTrendExtended,
  getProjectBreakdown,
  getModelBreakdown,
  ensureNotificationPermission,
  isBackend,
  isTauri,
  listAiProcesses,
  listDevServers,
  listPorts,
  listProcesses,
  diskInfo,
  loadDataVersioned,
  notify,
  opencodeSessions,
  opencodeSessionDetail,
  openExternal,
  gitBranch,
  recentSessions,
  restoreBackup,
  saveCostSettings,
  saveData,
  scanSessionCosts,
  systemInfo,
  terminateProcess,
} from "../lib/api";
import { demoBundle } from "../lib/demo";
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
} from "../types";

export type ProcView = "flat" | "tree";

const HISTORY_LEN = 60;
const TOAST_TTL_MS = 2600;
const SAVE_DEBOUNCE_MS = 300;

interface UiState {
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
  /** 进程页搜索词。放在 store 里是因为端口页/命令面板要能带着 PID 跳过来。 */
  procQuery: string;
  /** 跳转后要高亮的进程 PID（一次性） */
  focusPid: number | null;
  refreshMs: number;
  view: ViewKey;
  /** 当前打开的任务详情；null = 关闭。仅内存态，不跨启动恢复。 */
  taskDetailId: string | null;
  alwaysOnTop: boolean;
  setAlwaysOnTop: (v: boolean) => void;
}

interface RuntimeState {
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
  lastRefreshAt: number;
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

interface Store extends UiState, RuntimeState {
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
  loadAll: () => Promise<void>;
  refreshRuntime: () => Promise<void>;
  refreshAi: () => Promise<void>;
  loadSessionDetail: (port: number, id: string) => Promise<void>;
  fetchGitBranch: (dir: string) => Promise<string>;
  openTarget: (target: string) => Promise<void>;
  killProcess: (pid: number) => Promise<void>;
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
  backupCurrentData: () => ReturnType<typeof backupData>;
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

const emptyData: WorkbenchData = { projects: [], tasks: [] };

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** 系统是否要求减弱动效。jsdom / 老旧 WebView 没有 matchMedia，视为否。 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * 生效动效档位 = 显式选择优先，否则尊重系统 reduced-motion。
 *
 * 这是「允许覆盖」语义的唯一实现点：CSS 不再读 prefers-reduced-motion，
 * 全部动效断闸都走 data-motion 这一个属性。
 */
export function effectiveMotion(s: {
  motion: MotionLevel;
  motionExplicit: boolean;
}): MotionLevel {
  if (s.motion === "off") return "off";
  if (!s.motionExplicit && prefersReducedMotion()) return "off";
  return s.motion;
}

const MOTION_LEVELS: MotionLevel[] = ["off", "standard", "rich"];

function normalizeMotion(v: unknown): MotionLevel {
  return MOTION_LEVELS.includes(v as MotionLevel) ? (v as MotionLevel) : "standard";
}

/** 粒子/氛围强度统一钳制：非数字落默认 65，越界截断，取整。 */
export function normalizeIntensity(v: unknown, fallback = 65): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/**
 * 背景图白名单：只接受 data:image/* URL。
 * localStorage 一旦存进 script: 之类的东西，任何「把它当 CSS 用」的
 * 路径都是注入面——在写入源头就拒收，比在每个消费点防御便宜得多。
 */
export function isBackgroundDataUrl(v: unknown): v is string {
  return typeof v === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(v);
}

/**
 * persist 迁移主体（导出仅为单测可直接断言迁移行为）。
 *
 * 版本 3 → 4：新增动效档位与首启引导偏好。迁移只补默认值，
 * 不覆盖用户已显式保存的值——丢偏好的事故比缺默认值严重得多。
 */
export function migratePersisted(persisted: unknown): Record<string, unknown> {
  const state = (persisted ?? {}) as Record<string, unknown>;
  const rail = (state.railSections ?? {}) as Record<string, unknown>;
  const customThemes: ThemeInput[] = Array.isArray(state.customThemes)
    ? state.customThemes
        .map((x) => parseTheme(x))
        .filter((x): x is ThemeInput => Boolean(x))
    : [];
  return {
    ...state,
    customThemes,
    theme: migrateThemeId(state.theme, allThemes(customThemes)),
    shell: normalizeShell(state.shell),
    layout: normalizeLayout(state.layout),
    widgetOrder: normalizeOrder(state.widgetOrder),
    widgetHidden: normalizeHidden(state.widgetHidden),
    widgetSpans: normalizeSpans(state.widgetSpans),
    procView: state.procView === "tree" ? "tree" : "flat",
    taskView: state.taskView === "board" ? "board" : "list",
    taskScope:
      state.taskScope === "today" ||
      state.taskScope === "week" ||
      state.taskScope === "inbox"
        ? state.taskScope
        : "all",
    taskProjectFilter:
      typeof state.taskProjectFilter === "string" ? state.taskProjectFilter : "",
    railCollapsed: state.railCollapsed === true,
    railSections: {
      projects: rail.projects !== false,
      inbox: rail.inbox !== false,
      system: rail.system !== false,
    },
    motion: normalizeMotion(state.motion),
    motionExplicit: state.motionExplicit === true,
    onboardingDone: state.onboardingDone === true,
    workModes:
      normalizeWorkModes(state.workModes).length > 0
        ? normalizeWorkModes(state.workModes)
        : state.onboardingDone === true
          ? DEFAULT_WORK_MODES
          : [],
    workModeChosen:
      state.workModeChosen === true || state.onboardingDone === true,
    particles: state.particles === true,
    particlesIntensity: normalizeIntensity(state.particlesIntensity),
    backgroundImage: isBackgroundDataUrl(state.backgroundImage)
      ? state.backgroundImage
      : null,
  };
}

// 模块级防抖计时器（仅用于持久化，toast 由 TTL 自动清理）
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingData: WorkbenchData | null = null;
let saveQueue: Promise<void> = Promise.resolve();
let restoringData = false;
let dataSaveBlocked = true;
let dataGeneration: string | null = null;
let dataLoadSequence = 0;
let dataEditSequence = 0;
let dataDirty = false;

function enqueueSave(data: WorkbenchData): Promise<void> {
  const editSequence = dataEditSequence;
  const save = saveQueue
    .catch(() => undefined)
    .then(async () => {
      if (dataGeneration === null) throw new Error("数据尚未加载");
      dataGeneration = await saveData(data, dataGeneration);
      if (editSequence === dataEditSequence) dataDirty = false;
    });
  saveQueue = save;
  return save;
}
// 运行时刷新的在途 promise（并发调用复用它，而不是丢弃）
let inflightRefresh: Promise<void> | null = null;
// 在途期间又有新请求时置位，当前刷新结束后补跑一次
let refreshAgain = false;
let costScanAgain = false;
let aiRefreshId = 0;

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      theme: DEFAULT_THEME_ID,
      customThemes: [],
      // 动效默认「标准」（总监拍板）：第一印象有生命感，又不至于满档功耗
      motion: "standard",
      motionExplicit: false,
      onboardingDone: false,
      workModes: [],
      workModeChosen: false,
      particles: false,
      particlesIntensity: 65,
      backgroundImage: null,
      shell: "rail",
      layout: "bento",
      widgetOrder: DEFAULT_ORDER,
      widgetHidden: [],
      widgetSpans: {},
      procView: "flat",
      taskView: "list",
      taskScope: "all",
      taskProjectFilter: "",
      railCollapsed: false,
      railSections: { projects: true, inbox: true, system: true },
      procQuery: "",
      focusPid: null,
      refreshMs: 3000,
      view: "today",
      taskDetailId: null,
      alwaysOnTop: false,
      setAlwaysOnTop: (v) => set({ alwaysOnTop: v }),
      procs: [],
      ports: [],
      devs: [],
      ais: [],
      sessions: [],
      opencodePort: 4096,
      sessionsErr: "",
      sessionFiles: [],
      sessionFilesErr: "",
      sessionDetail: null,
      sessionDetailLoading: false,
      sysinfo: null,
      disks: [],
      gitBranches: {},
      loading: false,
      runtimeError: "",
      lastRefreshAt: 0,
      history: [],
      costOverview: null,
      costTrend: [],
      costModelBreakdown: [],
      costProjectBreakdown: [],
      costTrendMonthly: [],
      costTrendDays: 14,
      costSettings: {
        daily_budget: 5,
        monthly_budget: 50,
        alert_threshold_pct: 80,
        include_estimated: true,
      },
      costLoading: false,
      costNotified: false,
      data: emptyData,
      toast: "",
      killTarget: null,

      setView: (v) => set({ view: v, taskDetailId: null }),
      setTaskDetailId: (id) => set({ taskDetailId: id }),
      setMotion: (m) => {
        // 显式选档 = 覆盖系统 reduced-motion；立即落到 DOM，
        // 否则三档切换要等下一次主题应用才生效（实测会「点了没反应」）。
        set({ motion: m, motionExplicit: true });
        applyMotion(effectiveMotion(get()));
      },
      setOnboardingDone: () => {
        const current = get();
        set({
          onboardingDone: true,
          workModeChosen: true,
          workModes:
            current.workModes.length > 0 ? current.workModes : DEFAULT_WORK_MODES,
        });
      },
      setWorkModes: (modes) => {
        const normalized = normalizeWorkModes(modes);
        set({
          workModes: normalized,
          workModeChosen: normalized.length > 0,
        });
      },
      setWorkModeChosen: (chosen) => set({ workModeChosen: chosen }),
      setTaskView: (v) => set({ taskView: v }),
      setTaskScope: (v) => set({ taskScope: v }),
      setTaskProjectFilter: (id) => set({ taskProjectFilter: id }),
      setRailCollapsed: (v) => set({ railCollapsed: v }),
      setRailSection: (key, v) =>
        set((s) => ({ railSections: { ...s.railSections, [key]: v } })),
      resetRailSections: () =>
        set({ railSections: { projects: true, inbox: true, system: true } }),
      setParticles: (v) => set({ particles: v }),
      setParticlesIntensity: (v) => set({ particlesIntensity: normalizeIntensity(v) }),
      setBackground: (dataUrl) =>
        set({
          backgroundImage:
            dataUrl === null ? null : isBackgroundDataUrl(dataUrl) ? dataUrl : null,
        }),
      setTheme: (id) => {
        set({ theme: id });
        const s = get();
        applyTheme(tokensFor(id, s.customThemes), s.shell, s.layout);
      },
      upsertTheme: (theme) => {
        // 内置主题不进自定义列表：它们随版本升级一起更新，不该被用户副本覆盖。
        // 但「选中一个内置主题」是合法操作 —— 直接走 setTheme，
        // 否则会把 theme 设成一个在列表里不存在的 id（悬空引用，
        // tokensFor 会回退到第一套主题，界面和状态对不上）。
        if (theme.builtin) {
          // 只有真实存在的内置主题才能被选中；否则保留当前主题，
          // 避免 theme 指向一个列表里不存在的 id。
          const known = BUILTIN_THEMES.some((t) => t.id === theme.id);
          if (known) get().setTheme(theme.id);
          return theme.id;
        }
        const existing = get().customThemes;
        const next = [
          ...existing.filter((t) => t.id !== theme.id),
          { ...theme, builtin: false },
        ];
        set({ customThemes: next, theme: theme.id });
        const s = get();
        applyTheme(tokensFor(theme.id, next), s.shell, s.layout);
        return theme.id;
      },
      deleteTheme: (id) => {
        const existing = get().customThemes.filter((t) => t.id !== id);
        const current = get().theme === id ? DEFAULT_THEME_ID : get().theme;
        set({ customThemes: existing, theme: current });
        const s = get();
        applyTheme(tokensFor(current, existing), s.shell, s.layout);
      },
      importTheme: (json) => {
        let raw: unknown;
        try {
          raw = JSON.parse(json);
        } catch {
          return { ok: false, error: t("theme.errJson") };
        }
        const parsed = parseTheme(raw);
        if (!parsed) return { ok: false, error: t("theme.errShape") };
        // 与内置或已有自定义 id 冲突时改名，避免悄悄覆盖别人的主题
        let id = parsed.id;
        const taken = new Set(allThemes(get().customThemes).map((x) => x.id));
        if (taken.has(id)) id = `${id}-${Math.random().toString(36).slice(2, 6)}`;
        get().upsertTheme({ ...parsed, id });
        return { ok: true, id };
      },
      setShell: (shell) => {
        set({ shell });
        const s = get();
        applyTheme(tokensFor(s.theme, s.customThemes), shell, s.layout);
      },
      setLayout: (layout) => {
        set({ layout });
        // 布局也要写进 dataset：CSS 与测试都按 data-layout 判断当前版面，
        // 只改 store 会让属性永远停在初始值（实测切换后仍是 bento）。
        document.documentElement.dataset.layout = layout;
      },
      setWidgetOrder: (widgetOrder) => set({ widgetOrder: normalizeOrder(widgetOrder) }),
      setWidgetHidden: (widgetHidden) =>
        set({ widgetHidden: normalizeHidden(widgetHidden) }),
      setWidgetSpan: (id, span) =>
        set((s) => ({ widgetSpans: normalizeSpans({ ...s.widgetSpans, [id]: span }) })),
      resetWidgets: () =>
        set({ widgetOrder: DEFAULT_ORDER, widgetHidden: [], widgetSpans: {} }),
      setProcView: (procView) => set({ procView }),
      setProcQuery: (procQuery) => set({ procQuery }),
      setFocusPid: (focusPid) => set({ focusPid }),
      setRefreshMs: (ms) => set({ refreshMs: ms }),
      setToast: (t) => {
        set({ toast: t });
        setTimeout(() => {
          // 仅在 toast 未被新内容替换时才清除
          set((s) => (s.toast === t ? { toast: "" } : {}));
        }, TOAST_TTL_MS);
      },
      clearToast: () => set({ toast: "" }),
      setKillTarget: (p) => set({ killTarget: p }),

      loadAll: async () => {
        // 浏览器里可能是「连着 HTTP 后端」也可能是「纯静态预览」：
        // 先探一次（结果会广播给模式徽章），再决定走真实数据还是演示数据。
        if (!isTauri() && currentTransport() !== "http") {
          await detectTransport();
        }
        if (!isBackend()) {
          // 纯静态预览（既不是桌面壳、也没有 HTTP 后端）：注入演示数据。
          // 连着 `workbench serve` 的浏览器走下面的真实路径。
          const seed = [0, 1, 2].map((i) => ({
            cpu: Math.round(20 + i * 3),
            memGb: Math.round((12 + i * 0.4) * 100) / 100,
            t: Date.now() - (3 - i) * 3000,
          }));
          // 演示数据跟随界面语言：否则英文界面里会混进中文项目名与日志。
          const demo = demoBundle(getLang());
          set({
            data: demo.data,
            procs: demo.procs,
            ports: demo.ports,
            devs: demo.devs,
            ais: demo.ais,
            sessionFiles: demo.sessionFiles,
            sysinfo: demo.sysinfo,
            disks: demo.disks,
            costOverview: demo.costOverview,
            costTrend: demo.costTrend,
            costModelBreakdown: demo.costModelBreakdown,
            costProjectBreakdown: demo.costProjectBreakdown,
            costTrendMonthly: demo.costTrendMonthly,
            costTrendDays: 14,
            history: seed,
            loading: false,
            lastRefreshAt: Date.now(),
          });
          return;
        }
        const loadSequence = ++dataLoadSequence;
        const editSequence = dataEditSequence;
        const generation = dataGeneration;
        try {
          const snapshot = await loadDataVersioned();
          if (
            loadSequence === dataLoadSequence &&
            editSequence === dataEditSequence &&
            generation === dataGeneration &&
            !restoringData &&
            !dataDirty
          ) {
            dataGeneration = snapshot.generation;
            set({ data: { ...emptyData, ...snapshot.data } });
            dataSaveBlocked = false;
          }
        } catch (e) {
          if (
            loadSequence === dataLoadSequence &&
            editSequence === dataEditSequence &&
            generation === dataGeneration &&
            !dataDirty
          ) {
            dataSaveBlocked = true;
            set({ toast: t("store.loadFailed", { err: String(e) }) });
          }
        }
        get().refreshRuntime();
        get().refreshAi();
      },

      refreshRuntime: async () => {
        if (!isBackend()) return;
        // 刷新重入保护：netstat + 进程快照耗时可超过最短刷新间隔（设置页有 1s 档），
        // 不加锁会让并发调用乱序覆盖数据，并丢掉 history 采样点。
        //
        // 但直接 return 会**丢弃**请求：终止进程后的补刷、手动点「立即刷新」、
        // 窗口恢复可见时的补刷都会静默失效，UI 要等下一个定时器才更新。
        // 因此并发调用复用同一份在途 promise，并记一个 pending 标记，
        // 让当前刷新结束后再补跑一次（保证看到的是最新状态）。
        if (inflightRefresh) {
          refreshAgain = true;
          return inflightRefresh;
        }

        const sample = async () => {
          set({ loading: true });
          try {
            const [procs, ports, devs, ais, sys, dk] = await Promise.all([
              listProcesses(),
              listPorts(),
              listDevServers(),
              listAiProcesses(),
              systemInfo().catch(() => null),
              diskInfo().catch(() => []),
            ]);
            const cpuSum = procs.reduce((acc, p) => acc + (p.cpu ?? 0), 0);
            const memTotal = procs.reduce((acc, p) => acc + (p.memory ?? 0), 0);
            const point = {
              cpu: Math.round(cpuSum),
              memGb: Math.round((memTotal / 1024 ** 3) * 100) / 100,
              t: Date.now(),
            };
            // 用函数式 set 追加，避免与并发写入互相覆盖采样点
            const history = [...get().history.slice(-(HISTORY_LEN - 1)), point];
            set({
              procs,
              ports,
              devs,
              ais,
              sysinfo: sys,
              disks: dk,
              history,
              loading: false,
              runtimeError: "",
              lastRefreshAt: Date.now(),
            });
          } catch (e) {
            set({
              loading: false,
              runtimeError: String(e),
              toast: t("store.refreshFailed", { err: String(e) }),
            });
          }
        };

        inflightRefresh = sample();
        try {
          await inflightRefresh;
        } finally {
          inflightRefresh = null;
          if (refreshAgain) {
            refreshAgain = false;
            void get().refreshRuntime();
          }
        }
      },

      refreshAi: async () => {
        if (!isBackend()) return;
        const requestId = ++aiRefreshId;
        const [online, files] = await Promise.allSettled([
          opencodeSessions(),
          recentSessions(),
        ]);
        if (requestId !== aiRefreshId) return;
        set((state) => ({
          sessions: online.status === "fulfilled" ? online.value.sessions : [],
          opencodePort:
            online.status === "fulfilled" ? online.value.port : state.opencodePort,
          sessionsErr: online.status === "rejected" ? String(online.reason) : "",
          sessionFiles: files.status === "fulfilled" ? files.value : state.sessionFiles,
          sessionFilesErr: files.status === "rejected" ? "failed" : "",
        }));
      },

      loadSessionDetail: async (port, id) => {
        set({ sessionDetailLoading: true });
        try {
          const detail = await opencodeSessionDetail(port, id);
          set({ sessionDetail: detail, sessionDetailLoading: false });
        } catch (e) {
          set({
            sessionDetail: {
              id,
              title: t("store.detailFailed"),
              message_count: 0,
              first_message: "",
              last_message: "",
              duration_seconds: 0,
              tools_used: [],
              error: String(e),
            },
            sessionDetailLoading: false,
          });
        }
      },

      fetchGitBranch: async (dir) => {
        const cached = get().gitBranches[dir];
        if (cached !== undefined) return cached;
        const branch = await gitBranch(dir).catch(() => "");
        set((s) => ({ gitBranches: { ...s.gitBranches, [dir]: branch } }));
        return branch;
      },

      /**
       * 打开 URL / 目录，失败时转成 toast。
       *
       * 所有调用点原先直接 `onClick={() => openExternal(...)}`：openExternal 是
       * async，被拒绝的 Promise 没人消费就变成 unhandled rejection，界面毫无反应
       * （目录被删、在离线盘上、或协议被拒时都会走到这里）。
       */
      openTarget: async (target) => {
        try {
          await openExternal(target);
        } catch (e) {
          set({ toast: t("store.openFailed", { err: String(e) }) });
        }
      },

      killProcess: async (pid) => {
        try {
          await terminateProcess(pid);
          set({ toast: t("store.killSent", { pid }), killTarget: null });
          get().refreshRuntime();
        } catch (e) {
          set({ toast: t("store.killFailed", { err: String(e) }) });
        }
      },

      addTask: (input) => {
        const now = Math.floor(Date.now() / 1000);
        const task: Task = {
          id: uid(),
          title: input.title?.trim() || t("store.unnamedTask"),
          status: input.status ?? "todo",
          priority: input.priority ?? "normal",
          due: input.due ?? null,
          project_id: input.project_id ?? null,
          tags: input.tags ?? [],
          created_at: now,
          updated_at: now,
        };
        return get().persistData({ ...get().data, tasks: [task, ...get().data.tasks] });
      },

      moveTask: (id, status) => {
        return get().updateTask(id, { status });
      },

      updateTask: (id, patch) => {
        const tasks = get().data.tasks.map((t) =>
          t.id === id ? { ...t, ...patch, updated_at: Math.floor(Date.now() / 1000) } : t
        );
        return get().persistData({ ...get().data, tasks });
      },

      deleteTask: (id) => {
        get().persistData({
          ...get().data,
          tasks: get().data.tasks.filter((t) => t.id !== id),
        });
      },

      addProject: (p) => {
        const project: Project = {
          id: uid(),
          name: p.name?.trim() || t("store.unnamedProject"),
          path: p.path?.trim() ?? "",
          status: p.status ?? "active",
          tags: p.tags ?? [],
          pinned: p.pinned ?? false,
          note: p.note ?? "",
          created_at: Math.floor(Date.now() / 1000),
        };
        return get().persistData({
          ...get().data,
          projects: [project, ...get().data.projects],
        });
      },

      updateProject: (id, patch) => {
        const projects = get().data.projects.map((p) =>
          p.id === id ? { ...p, ...patch } : p
        );
        return get().persistData({ ...get().data, projects });
      },

      deleteProject: (id) => {
        get().persistData({
          projects: get().data.projects.filter((p) => p.id !== id),
          tasks: get().data.tasks.map((t) =>
            t.project_id === id ? { ...t, project_id: null } : t
          ),
        });
      },

      persistData: (next) => {
        if (restoringData || (isBackend() && dataSaveBlocked)) {
          set({ toast: t("store.saveFailed", { err: "数据正在恢复或需要重新加载" }) });
          return false;
        }
        set({ data: next });
        if (!isBackend()) return true;
        if (saveTimer) clearTimeout(saveTimer);
        pendingData = next;
        dataDirty = true;
        const editSequence = ++dataEditSequence;
        saveTimer = setTimeout(() => {
          saveTimer = null;
          const data = pendingData;
          pendingData = null;
          if (data)
            void enqueueSave(data).catch((e) => {
              if (editSequence === dataEditSequence && !pendingData) pendingData = data;
              set({ toast: t("store.saveFailed", { err: String(e) }) });
            });
        }, SAVE_DEBOUNCE_MS);
        return true;
      },

      persistDataNow: async (next) => {
        if (restoringData || (isBackend() && dataSaveBlocked)) {
          set({ toast: t("store.saveFailed", { err: "数据正在恢复或需要重新加载" }) });
          return false;
        }
        if (!isBackend()) {
          set({ data: next });
          return true;
        }
        restoringData = true;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = null;
        try {
          await saveQueue.catch(() => undefined);
          if (pendingData) {
            const previous = pendingData;
            pendingData = null;
            try {
              await enqueueSave(previous);
            } catch (error) {
              pendingData = previous;
              throw error;
            }
          }
          await enqueueSave(next);
          dataEditSequence += 1;
          set({ data: next });
          return true;
        } finally {
          restoringData = false;
        }
      },

      discardUnsavedAndReload: async () => {
        if (restoringData) throw new Error("数据正在恢复");
        restoringData = true;
        dataLoadSequence += 1;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = null;
        try {
          await saveQueue.catch(() => undefined);
          const snapshot = await loadDataVersioned();
          pendingData = null;
          dataDirty = false;
          dataEditSequence += 1;
          dataGeneration = snapshot.generation;
          set({ data: { ...emptyData, ...snapshot.data } });
          dataSaveBlocked = false;
        } catch (error) {
          if (pendingData && !dataSaveBlocked) {
            const editSequence = dataEditSequence;
            saveTimer = setTimeout(() => {
              saveTimer = null;
              const data = pendingData;
              pendingData = null;
              if (data)
                void enqueueSave(data).catch((failure) => {
                  if (editSequence === dataEditSequence && !pendingData)
                    pendingData = data;
                  set({ toast: t("store.saveFailed", { err: String(failure) }) });
                });
            }, SAVE_DEBOUNCE_MS);
          }
          throw error;
        } finally {
          restoringData = false;
        }
      },

      backupCurrentData: async () => {
        if (restoringData) throw new Error("数据正在恢复或备份");
        restoringData = true;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = null;
        try {
          await saveQueue.catch(() => undefined);
          if (pendingData) {
            const data = pendingData;
            pendingData = null;
            try {
              await enqueueSave(data);
            } catch (error) {
              pendingData = data;
              throw error;
            }
          }
          if (dataDirty) throw new Error("有未保存的数据，无法创建备份");
          return await backupData();
        } finally {
          restoringData = false;
        }
      },

      restoreData: async (id) => {
        if (restoringData) throw new Error("数据正在恢复");
        restoringData = true;
        dataLoadSequence += 1;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = null;
        try {
          await saveQueue.catch(() => undefined);
          if (pendingData) {
            const data = pendingData;
            pendingData = null;
            try {
              await enqueueSave(data);
            } catch (error) {
              pendingData = data;
              throw new Error(
                `${String(error)}；未保存的数据仍在内存，请先导出 JSON 再重新加载`,
                { cause: error }
              );
            }
          }
          let result: RestoreResult | undefined;
          let restoreError: unknown;
          let restoreFailed = false;
          try {
            result = await restoreBackup(id);
          } catch (error) {
            restoreFailed = true;
            restoreError = error;
          }
          dataSaveBlocked = true;
          try {
            const snapshot = await loadDataVersioned();
            dataGeneration = snapshot.generation;
            set({ data: { ...emptyData, ...snapshot.data } });
            dataSaveBlocked = false;
          } catch (error) {
            if (restoreFailed) {
              throw new Error(`${String(restoreError)}；重新加载失败: ${String(error)}`, {
                cause: error,
              });
            }
            throw error;
          }
          if (restoreFailed) throw restoreError;
          if (!result) throw new Error("恢复未返回结果");
          return result;
        } finally {
          restoringData = false;
        }
      },

      // ── 成本计量 ──

      loadCostOverview: async () => {
        // 没有后端（纯静态预览）时保持初始状态，避免把 "reading 'invoke'"
        // 这类 TypeError 顶到 toast 上。
        if (!isBackend()) return;
        // 后端现在会把「数据文件损坏」等真实错误抛出来，不能再用 catch(()=>null) 吞掉，
        // 否则用户看到的是空白页而不是「账本读不了」。
        const errors: string[] = [];
        const track = <T>(label: string, p: Promise<T>, fallback: T): Promise<T> =>
          p.catch((e) => {
            errors.push(`${label}: ${String(e)}`);
            return fallback;
          });

        const [overview, extended, breakdown, projectRows, settings] = await Promise.all([
          track(t("store.track.overview"), getCostOverview(), null),
          track(t("store.track.trend"), getCostTrendExtended(get().costTrendDays), {
            days: get().costTrendDays,
            daily: [] as CostTrendRow[],
            monthly: [] as CostMonthRow[],
          }),
          track(
            t("store.track.breakdown"),
            getModelBreakdown(),
            [] as ModelBreakdownRow[]
          ),
          track(
            t("store.track.projectBreakdown"),
            getProjectBreakdown(),
            [] as ProjectBreakdownRow[]
          ),
          track(t("store.track.settings"), getCostSettings(), get().costSettings),
        ]);
        set({
          costOverview: overview,
          costTrend: extended.daily,
          costTrendMonthly: extended.monthly,
          costModelBreakdown: breakdown,
          costProjectBreakdown: projectRows,
          costSettings: settings,
        });
        if (errors.length) {
          // 多个接口同时失败时只显示第一条，但把总数带出来，避免「只坏了一个」的错觉
          const first = errors[0];
          const message = t("store.costReadFailed", {
            err: errors.length > 1 ? `${first} (+${errors.length - 1})` : first,
          });
          set({ toast: message });
          get().checkBudgetAlert();
          return message;
        }
        get().checkBudgetAlert();
      },

      loadCostTrend: async (days) => {
        if (!isBackend()) {
          set({ costTrendDays: days });
          return;
        }
        // 只切窗口：不碰 overview / settings，避免一次点击打四个查询
        try {
          const extended = await getCostTrendExtended(days);
          set({
            costTrendDays: days,
            costTrend: extended.daily,
            costTrendMonthly: extended.monthly,
          });
        } catch (e) {
          set({ toast: t("store.costReadFailed", { err: String(e) }) });
        }
      },

      scanCosts: async (options) => {
        if (!isBackend()) return;
        if (get().costLoading) {
          if (options?.afterCurrent) costScanAgain = true;
          return;
        }
        costScanAgain = false;
        set({ costLoading: true });
        let previousError = "";
        let repeat: boolean;
        try {
          do {
            const startedAt = Date.now();
            try {
              const result = await scanSessionCosts();
              const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
              set({
                costOverview: result.overview,
                costTrend: result.trend,
                costModelBreakdown: result.model_breakdown,
                toast:
                  previousError ||
                  t("ai.scannedSummary", { files: result.total_scanned, seconds }),
              });
              // 扫描结果不带项目归因/月度桶：补一次轻量聚合。
              // 失败只静默——主视图（overview/trend/breakdown）已经更新了。
              void getProjectBreakdown()
                .then((rows) => set({ costProjectBreakdown: rows }))
                .catch(() => {});
              void getCostTrendExtended(get().costTrendDays)
                .then((ext) =>
                  set({ costTrend: ext.daily, costTrendMonthly: ext.monthly })
                )
                .catch(() => {});
              get().checkBudgetAlert();
            } catch (e) {
              const scanError = t("store.scanFailed", { err: String(e) });
              try {
                const readError = await get().loadCostOverview();
                previousError = readError ? `${scanError} · ${readError}` : scanError;
              } catch (readError) {
                previousError = `${scanError} · ${t("store.costReadFailed", { err: String(readError) })}`;
              }
              set({ toast: previousError });
            }
            repeat = costScanAgain;
            costScanAgain = false;
          } while (repeat);
        } finally {
          set({ costLoading: false });
        }
      },

      loadCostSettings: async () => {
        if (!isBackend()) return;
        try {
          const s = await getCostSettings();
          set({ costSettings: s });
        } catch (e) {
          set({ toast: t("store.settingsLoadFailed", { err: String(e) }) });
        }
      },

      /**
       * 保存成本设置。返回是否成功 —— 调用方据此决定是否清掉「未保存」标记。
       * 原先失败也返回 void，设置页无条件 setDirty(false)，用户会以为已持久化。
       */
      updateCostSettings: async (s) => {
        // 无后端时返回 false 而不是抛错：调用方保持「未保存」状态，
        // 用户输入不会丢，也不会看到原始的 TypeError。
        if (!isBackend()) return false;
        try {
          await saveCostSettings(s);
        } catch (e) {
          set({ toast: t("store.settingsSaveFailed", { err: String(e) }) });
          return false;
        }
        // 保存成功后才落内存态：避免失败时界面显示未持久化的值
        set({ costSettings: s, toast: t("store.settingsSaved") });
        await get().loadCostOverview();
        get().checkBudgetAlert();
        return true;
      },

      clearCosts: async () => {
        if (!isBackend()) return;
        try {
          await clearCostRecords();
          set({
            costOverview: null,
            costTrend: [],
            costModelBreakdown: [],
            costProjectBreakdown: [],
            costTrendMonthly: [],
            costNotified: false,
            toast: t("store.cleared"),
          });
        } catch (e) {
          set({ toast: t("store.clearFailed", { err: String(e) }) });
        }
      },

      checkBudgetAlert: () => {
        const o = get().costOverview;
        if (!o) return;
        const exceeded =
          (o.daily_budget > 0 && o.daily_pct >= o.alert_threshold_pct) ||
          (o.monthly_budget > 0 && o.monthly_pct >= o.alert_threshold_pct);
        if (exceeded && !get().costNotified) {
          set({ costNotified: true });
          // 先确保拿到通知权限：未授权时 sendNotification 会静默失败，
          // 用户只看到界面横幅、收不到系统通知。
          void ensureNotificationPermission()
            .then((granted) =>
              granted
                ? notify(
                    t("store.alertTitle"),
                    t("store.alertBody", {
                      daily: o.daily_pct.toFixed(0),
                      monthly: o.monthly_pct.toFixed(0),
                      threshold: o.alert_threshold_pct,
                    })
                  )
                : undefined
            )
            .catch(() => {});
        }
        if (!exceeded) {
          set({ costNotified: false });
        }
      },
    }),
    {
      name: "workbench-ui-v1",
      // 版本 1 → 2：theme 从 "dark"/"light" 变成风格 id。
      // 版本 3：主题变成可编辑数据（+ customThemes）、新增 shell / layout / 组件摆放。
      // 版本 4：新增动效档位（motion/motionExplicit）与首启引导标记。
      // 版本 5：新增氛围粒子开关（particles，默认关）。
      // 版本 6：新增粒子强度（默认 65）与自定义背景图（默认 null）。
      // 版本 7：新增工作方式多选与任务页视图/范围/项目筛选。
      // 版本 8：新增首页右栏收起状态与分区可见性。
      // 迁移只做「补齐与清洗」，不覆盖用户的显式选择。
      version: 8,
      migrate: (persisted: unknown) => migratePersisted(persisted) as never,
      partialize: (s) => ({
        theme: s.theme,
        customThemes: s.customThemes,
        motion: s.motion,
        motionExplicit: s.motionExplicit,
        onboardingDone: s.onboardingDone,
        workModes: s.workModes,
        workModeChosen: s.workModeChosen,
        particles: s.particles,
        particlesIntensity: s.particlesIntensity,
        backgroundImage: s.backgroundImage,
        shell: s.shell,
        layout: s.layout,
        widgetOrder: s.widgetOrder,
        widgetHidden: s.widgetHidden,
        widgetSpans: s.widgetSpans,
        procView: s.procView,
        taskView: s.taskView,
        taskScope: s.taskScope,
        taskProjectFilter: s.taskProjectFilter,
        railCollapsed: s.railCollapsed,
        railSections: s.railSections,
        refreshMs: s.refreshMs,
        alwaysOnTop: s.alwaysOnTop,
      }),
    }
  )
);
