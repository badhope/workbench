import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_THEME_ID } from "../theme/presets";
import { DEFAULT_ORDER } from "../layout";
import { DEFAULT_PROC_COLUMNS } from "../procColumns";
import { emptyData, migratePersisted } from "./helpers";
import { activePersistence, createPersistence } from "./persistence";
import type { Store } from "./types";
import { createUiActions } from "./uiActions";
import { createDataActions } from "./dataActions";
import { createRuntimeActions } from "./runtimeActions";
import { createCostActions } from "./costActions";

export type { ProcView } from "./types";
export {
  effectiveMotion,
  isBackgroundDataUrl,
  migratePersisted,
  normalizeIntensity,
  prefersReducedMotion,
} from "./helpers";

export const useStore = create<Store>()(
  persist(
    (set, get) => {
      const persistence = createPersistence();
      return {
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
        procColumns: DEFAULT_PROC_COLUMNS,
        taskView: "list",
        taskScope: "all",
        taskProjectFilter: "",
        railCollapsed: false,
        railSections: { projects: true, inbox: true, system: true },
        navCollapsed: false,
        procQuery: "",
        focusPid: null,
        refreshMs: 3000,
        view: "today",
        taskDetailId: null,
        alwaysOnTop: false,
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
        dataLoadError: "",
        lastRefreshAt: 0,
        lastDataUpdatedAt: 0,
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
        ...createUiActions(set, get),
        ...createDataActions(set, get, persistence),
        ...createRuntimeActions(set, get, persistence),
        ...createCostActions(set, get),
      };
    },
    {
      name: "workbench-ui-v1",
      // 版本 1 → 2：theme 从 "dark"/"light" 变成风格 id。
      // 版本 3：主题变成可编辑数据（+ customThemes）、新增 shell / layout / 组件摆放。
      // 版本 4：新增动效档位（motion/motionExplicit）与首启引导标记。
      // 版本 5：新增氛围粒子开关（particles，默认关）。
      // 版本 6：新增粒子强度（默认 65）与自定义背景图（默认 null）。
      // 版本 7：新增工作方式多选与任务页视图/范围/项目筛选。
      // 版本 8：新增首页右栏收起状态与分区可见性。
      // 版本 9：新增进程表列显示/顺序偏好。
      // 迁移只做「补齐与清洗」，不覆盖用户的显式选择。
      version: 9,
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
        procColumns: s.procColumns,
        taskView: s.taskView,
        taskScope: s.taskScope,
        taskProjectFilter: s.taskProjectFilter,
        railCollapsed: s.railCollapsed,
        railSections: s.railSections,
        navCollapsed: s.navCollapsed,
        refreshMs: s.refreshMs,
        alwaysOnTop: s.alwaysOnTop,
      }),
    }
  )
);

/** 退出前把防抖窗口内的数据立刻落盘；失败时数据留在 pendingData。 */
export async function flushPendingSave(): Promise<void> {
  try {
    await activePersistence().flush();
  } catch {
    // 退出路径上无法再提示；数据仍在磁盘的上一版，至少不是半截文件。
  }
}
