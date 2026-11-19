import {
  clearCostRecords,
  ensureNotificationPermission,
  getCostOverview,
  getCostSettings,
  getCostTrendExtended,
  getModelBreakdown,
  getProjectBreakdown,
  isBackend,
  notify,
  saveCostSettings,
  scanSessionCosts,
} from "../api";
import { t } from "../i18n";
import type {
  CostSettings,
  CostTrendRow,
  CostMonthRow,
  CostOverview,
  ModelBreakdownRow,
  ProjectBreakdownRow,
} from "../../types";
import type { Store, StoreGet, StoreSet } from "./types";

export type CostActions = Pick<
  Store,
  | "loadCostOverview"
  | "loadCostTrend"
  | "scanCosts"
  | "loadCostSettings"
  | "updateCostSettings"
  | "clearCosts"
  | "checkBudgetAlert"
>;

export function createCostActions(set: StoreSet, get: StoreGet): CostActions {
  // 扫描在途期间又收到「立即扫描」时，当前扫描结束后补跑一次
  let costScanAgain = false;

  return {
    loadCostOverview: async () => {
      // 没有后端（纯静态预览）时保持初始状态，避免把 "reading 'invoke'"
      // 这类 TypeError 顶到 toast 上。
      if (!isBackend()) return;
      // 后端现在会把「数据文件损坏」等真实错误抛出来，不能再用 catch(()=>null) 吞掉，
      // 否则用户看到的是空白页而不是「账本读不了」。
      const errors: string[] = [];
      const track = <T>(label: string, promise: Promise<T>, fallback: T): Promise<T> =>
        promise.catch((e) => {
          errors.push(`${label}: ${String(e)}`);
          return fallback;
        });

      const [overview, extended, breakdown, projectRows, settings] = await Promise.all([
        track(t("store.track.overview"), getCostOverview(), null as CostOverview | null),
        track(t("store.track.trend"), getCostTrendExtended(get().costTrendDays), {
          days: get().costTrendDays,
          daily: [] as CostTrendRow[],
          monthly: [] as CostMonthRow[],
        }),
        track(t("store.track.breakdown"), getModelBreakdown(), [] as ModelBreakdownRow[]),
        track(
          t("store.track.projectBreakdown"),
          getProjectBreakdown(),
          [] as ProjectBreakdownRow[]
        ),
        track(
          t("store.track.settings"),
          getCostSettings(),
          get().costSettings as CostSettings
        ),
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
              .then((ext) => set({ costTrend: ext.daily, costTrendMonthly: ext.monthly }))
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
        const settings = await getCostSettings();
        set({ costSettings: settings });
      } catch (e) {
        set({ toast: t("store.settingsLoadFailed", { err: String(e) }) });
      }
    },

    /**
     * 保存成本设置。返回是否成功 —— 调用方据此决定是否清掉「未保存」标记。
     * 原先失败也返回 void，设置页无条件 setDirty(false)，用户会以为已持久化。
     */
    updateCostSettings: async (settings) => {
      // 无后端时返回 false 而不是抛错：调用方保持「未保存」状态，
      // 用户输入不会丢，也不会看到原始的 TypeError。
      if (!isBackend()) return false;
      try {
        await saveCostSettings(settings);
      } catch (e) {
        set({ toast: t("store.settingsSaveFailed", { err: String(e) }) });
        return false;
      }
      // 保存成功后才落内存态：避免失败时界面显示未持久化的值
      set({ costSettings: settings, toast: t("store.settingsSaved") });
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
      const overview = get().costOverview;
      if (!overview) return;
      const exceeded =
        (overview.daily_budget > 0 &&
          overview.daily_pct >= overview.alert_threshold_pct) ||
        (overview.monthly_budget > 0 &&
          overview.monthly_pct >= overview.alert_threshold_pct);
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
                    daily: overview.daily_pct.toFixed(0),
                    monthly: overview.monthly_pct.toFixed(0),
                    threshold: overview.alert_threshold_pct,
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
  };
}
