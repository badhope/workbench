import {
  diskInfo,
  gitBranch,
  isBackend,
  isTauri,
  listAiProcesses,
  listDevServers,
  listPorts,
  listProcesses,
  opencodeSessionDetail,
  opencodeSessions,
  openExternal,
  recentSessions,
  systemInfo,
  terminateProcess,
} from "../api";
import { currentTransport, detectTransport } from "../transport";
import { demoBundle } from "../demo";
import { getLang, t } from "../i18n";
import { HISTORY_LEN, mergeSnapshot } from "./helpers";
import type { LoadTicket, Persistence } from "./persistence";
import type { Store, StoreGet, StoreSet } from "./types";

async function adoptSnapshot(
  p: Persistence,
  ticket: LoadTicket,
  set: StoreSet
): Promise<void> {
  const snapshot = await p.load();
  if (!p.isCurrent(ticket) || p.isRestoring() || p.isDirty()) return;
  p.setGeneration(snapshot.generation);
  set({
    data: mergeSnapshot(snapshot.data),
    lastDataUpdatedAt: Date.now(),
    dataLoadError: "",
  });
  p.setBlocked(false);
}

export type RuntimeActions = Pick<
  Store,
  | "loadAll"
  | "refreshData"
  | "refreshRuntime"
  | "refreshAi"
  | "loadSessionDetail"
  | "fetchGitBranch"
  | "openTarget"
  | "killProcess"
>;

export function createRuntimeActions(
  set: StoreSet,
  get: StoreGet,
  p: Persistence
): RuntimeActions {
  // 运行时刷新的在途 promise（并发调用复用它，而不是丢弃）
  let inflightRefresh: Promise<void> | null = null;
  let inflightDataRefresh: Promise<void> | null = null;
  // 在途期间又有新请求时置位，当前刷新结束后补跑一次
  let refreshAgain = false;
  let aiRefreshId = 0;

  return {
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
          lastDataUpdatedAt: Date.now(),
          dataLoadError: "",
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
      const ticket = p.capture();
      try {
        await adoptSnapshot(p, ticket, set);
      } catch (e) {
        if (p.isCurrent(ticket) && !p.isDirty()) {
          p.setBlocked(true);
          set({
            dataLoadError: String(e),
            toast: t("store.loadFailed", { err: String(e) }),
          });
        }
      }
      get().refreshRuntime();
      get().refreshAi();
    },

    refreshData: async () => {
      if (!isBackend() || p.isRestoring() || p.isDirty()) return;
      if (inflightDataRefresh) return inflightDataRefresh;
      const ticket = p.capture();
      const run = (async () => {
        try {
          await adoptSnapshot(p, ticket, set);
        } catch {
          // 后台刷新失败保留现有数据，避免每 30 秒弹一次 toast 打扰工作。
        } finally {
          inflightDataRefresh = null;
        }
      })();
      inflightDataRefresh = run;
      return run;
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
          const cpuSum = procs.reduce((acc, proc) => acc + (proc.cpu ?? 0), 0);
          const memTotal = procs.reduce((acc, proc) => acc + (proc.memory ?? 0), 0);
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

    killProcess: async (target) => {
      try {
        await terminateProcess(target.pid, target.name, target.start_time);
        set({ toast: t("store.killSent", { pid: target.pid }), killTarget: null });
        get().refreshRuntime();
      } catch (e) {
        set({ toast: t("store.killFailed", { err: String(e) }) });
      }
    },
  };
}
