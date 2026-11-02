import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * store 的运行时动作（IPC 路径）。
 *
 * 之前 store 只测了任务/项目 CRUD 与主题偏好，所有「调后端」的分支都没覆盖：
 * 失败路径（后端报错时 toast 内容）、并发重入（refreshRuntime 的 in-flight
 * 复跑）、以及演示模式的短路。这三类恰恰是最容易写错、也最难手工验证的。
 */
const api = {
  loadData: vi.fn(),
  loadDataVersioned: vi.fn(),
  restoreBackup: vi.fn(),
  saveData: vi.fn(),
  listProcesses: vi.fn(),
  listPorts: vi.fn(),
  listDevServers: vi.fn(),
  listAiProcesses: vi.fn(),
  systemInfo: vi.fn(),
  diskInfo: vi.fn(),
  opencodeSessions: vi.fn(),
  recentSessions: vi.fn(),
  opencodeSessionDetail: vi.fn(),
  gitBranch: vi.fn(),
  terminateProcess: vi.fn(),
  openExternal: vi.fn(),
  getCostOverview: vi.fn(),
  getCostTrend: vi.fn(),
  getModelBreakdown: vi.fn(),
  getCostSettings: vi.fn(),
  saveCostSettings: vi.fn(),
  scanSessionCosts: vi.fn(),
  clearCostRecords: vi.fn(),
  notify: vi.fn(),
  ensureNotificationPermission: vi.fn(),
};

// isTauri 用可变开关：同一批用例里既能测桌面路径也能测演示路径
let tauriMode = true;
vi.mock("./api", () => ({
  ...api,
  isTauri: () => tauriMode,
}));

const { useStore } = await import("./store");
const { setLang } = await import("./i18n");

setLang("zh");

const proc = (over: Record<string, unknown> = {}) => ({
  pid: 1,
  name: "node.exe",
  cmd_line: "node",
  exe_path: "C:\\node.exe",
  cpu: 10,
  memory: 1024 * 1024 * 100,
  status: "running",
  start_time: 1,
  parent_pid: 0,
  ...over,
});

function reset() {
  useStore.setState({
    procs: [],
    ports: [],
    devs: [],
    ais: [],
    sessions: [],
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
    toast: "",
    killTarget: null,
    costOverview: null,
    costTrend: [],
    costModelBreakdown: [],
    costLoading: false,
    costNotified: false,
  });
  Object.values(api).forEach((fn) => fn.mockReset());
  tauriMode = true;
}

beforeEach(reset);

describe("refreshRuntime", () => {
  it("成功时写入快照、追加采样点并清空错误", async () => {
    api.listProcesses.mockResolvedValue([proc(), proc({ pid: 2, cpu: 5 })]);
    api.listPorts.mockResolvedValue([]);
    api.listDevServers.mockResolvedValue([]);
    api.listAiProcesses.mockResolvedValue([]);
    api.systemInfo.mockResolvedValue({ total_memory: 16 * 1024 ** 3 });
    api.diskInfo.mockResolvedValue([]);

    await useStore.getState().refreshRuntime();

    const s = useStore.getState();
    expect(s.procs).toHaveLength(2);
    expect(s.history).toHaveLength(1);
    // CPU 是各进程之和，不是平均
    expect(s.history[0].cpu).toBe(15);
    expect(s.loading).toBe(false);
    expect(s.runtimeError).toBe("");
    expect(s.lastRefreshAt).toBeGreaterThan(0);
  });

  it("失败时写入 runtimeError 与 toast，并结束 loading", async () => {
    api.listProcesses.mockRejectedValue(new Error("boom"));
    api.listPorts.mockResolvedValue([]);
    api.listDevServers.mockResolvedValue([]);
    api.listAiProcesses.mockResolvedValue([]);
    api.systemInfo.mockResolvedValue(null);
    api.diskInfo.mockResolvedValue([]);

    await useStore.getState().refreshRuntime();

    const s = useStore.getState();
    expect(s.loading).toBe(false);
    expect(s.runtimeError).toContain("boom");
    expect(s.toast).toContain("boom");
  });

  it("systemInfo / diskInfo 失败不影响进程数据（可选依赖降级）", async () => {
    api.listProcesses.mockResolvedValue([proc()]);
    api.listPorts.mockResolvedValue([]);
    api.listDevServers.mockResolvedValue([]);
    api.listAiProcesses.mockResolvedValue([]);
    api.systemInfo.mockRejectedValue(new Error("no sysinfo"));
    api.diskInfo.mockRejectedValue(new Error("no disks"));

    await useStore.getState().refreshRuntime();

    const s = useStore.getState();
    expect(s.procs).toHaveLength(1);
    expect(s.sysinfo).toBeNull();
    expect(s.disks).toEqual([]);
    expect(s.runtimeError).toBe("");
  });

  it("并发调用复用同一个 in-flight promise，不重复采集", async () => {
    let resolveProcs: (v: unknown) => void = () => {};
    api.listProcesses.mockReturnValue(
      new Promise((r) => {
        resolveProcs = r;
      })
    );
    api.listPorts.mockResolvedValue([]);
    api.listDevServers.mockResolvedValue([]);
    api.listAiProcesses.mockResolvedValue([]);
    api.systemInfo.mockResolvedValue(null);
    api.diskInfo.mockResolvedValue([]);

    const first = useStore.getState().refreshRuntime();
    const second = useStore.getState().refreshRuntime();
    expect(api.listProcesses).toHaveBeenCalledTimes(1);

    resolveProcs([proc()]);
    await Promise.all([first, second]);

    // 第二次被折叠进补跑：结束后应再采集一次（拿到最新状态）
    expect(api.listProcesses).toHaveBeenCalledTimes(2);
    expect(useStore.getState().procs).toHaveLength(1);
  });

  it("历史采样点被截断到 60 个", async () => {
    api.listProcesses.mockResolvedValue([]);
    api.listPorts.mockResolvedValue([]);
    api.listDevServers.mockResolvedValue([]);
    api.listAiProcesses.mockResolvedValue([]);
    api.systemInfo.mockResolvedValue(null);
    api.diskInfo.mockResolvedValue([]);

    useStore.setState({
      history: Array.from({ length: 60 }, (_, i) => ({ cpu: i, memGb: 1, t: i })),
    });
    await useStore.getState().refreshRuntime();

    const h = useStore.getState().history;
    expect(h).toHaveLength(60);
    // 新的在末尾，老的被挤出
    expect(h[h.length - 1].cpu).toBe(0);
  });
});

describe("loadAll", () => {
  it("演示模式注入示例数据且不调 IPC", async () => {
    tauriMode = false;
    await useStore.getState().loadAll();
    expect(api.loadData).not.toHaveBeenCalled();
    expect(useStore.getState().procs.length).toBeGreaterThan(0);
    expect(useStore.getState().lastRefreshAt).toBeGreaterThan(0);
  });

  it("桌面模式读盘失败时提示，但仍继续刷新运行时", async () => {
    api.loadDataVersioned.mockRejectedValue(new Error("corrupt"));
    api.listProcesses.mockResolvedValue([proc()]);
    api.listPorts.mockResolvedValue([]);
    api.listDevServers.mockResolvedValue([]);
    api.listAiProcesses.mockResolvedValue([]);
    api.systemInfo.mockResolvedValue(null);
    api.diskInfo.mockResolvedValue([]);
    api.opencodeSessions.mockResolvedValue({ port: 4096, sessions: [] });
    api.recentSessions.mockResolvedValue([]);

    await useStore.getState().loadAll();
    await new Promise((r) => setTimeout(r, 30));

    expect(useStore.getState().toast).toContain("corrupt");
    expect(api.listProcesses).toHaveBeenCalled();
  });
});

describe("refreshAi", () => {
  it("并发请求乱序完成时只提交最新文件结果，错误与列表同时更新", async () => {
    let resolveOld!: (files: { path: string }[]) => void;
    let resolveNew!: (files: { path: string }[]) => void;
    let resolveOldOnline!: (result: { port: number; sessions: never[] }) => void;
    api.opencodeSessions
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOldOnline = resolve;
        })
      )
      .mockResolvedValueOnce({ port: 4096, sessions: [] });
    api.recentSessions
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve;
        })
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveNew = resolve;
        })
      );
    useStore.setState({ sessionFilesErr: "previous failure" });
    const first = useStore.getState().refreshAi();
    const second = useStore.getState().refreshAi();
    resolveNew([{ path: "new.jsonl" }]);
    await second;
    resolveOld([{ path: "old.jsonl" }]);
    await Promise.resolve();
    expect(useStore.getState().sessionFiles).toEqual([{ path: "new.jsonl" }]);
    expect(useStore.getState().sessionFilesErr).toBe("");
    resolveOldOnline({ port: 4096, sessions: [] });
    await first;
    expect(useStore.getState().sessionFiles).toEqual([{ path: "new.jsonl" }]);
    expect(useStore.getState().sessionFilesErr).toBe("");
  });

  it("文件结果在在线请求未结束时不会提前改变错误或列表", async () => {
    let resolveOnline!: (result: { port: number; sessions: never[] }) => void;
    api.opencodeSessions.mockReturnValue(
      new Promise((resolve) => {
        resolveOnline = resolve;
      })
    );
    api.recentSessions.mockResolvedValue([{ path: "new.jsonl" }]);
    useStore.setState({
      sessionFiles: [{ path: "saved.jsonl" }] as never,
      sessionFilesErr: "failed",
    });
    const pending = useStore.getState().refreshAi();
    await Promise.resolve();
    expect(useStore.getState().sessionFiles).toEqual([{ path: "saved.jsonl" }]);
    expect(useStore.getState().sessionFilesErr).toBe("failed");
    resolveOnline({ port: 4096, sessions: [] });
    await pending;
    expect(useStore.getState().sessionFiles).toEqual([{ path: "new.jsonl" }]);
    expect(useStore.getState().sessionFilesErr).toBe("");
  });

  it("旧请求失败不能覆盖新请求成功", async () => {
    let rejectOld!: (error: Error) => void;
    api.opencodeSessions.mockResolvedValue({ port: 4096, sessions: [] });
    api.recentSessions
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectOld = reject;
        })
      )
      .mockResolvedValueOnce([{ path: "new.jsonl" }]);
    const first = useStore.getState().refreshAi();
    await useStore.getState().refreshAi();
    rejectOld(new Error("old failure"));
    await first;
    expect(useStore.getState().sessionFiles).toEqual([{ path: "new.jsonl" }]);
    expect(useStore.getState().sessionFilesErr).toBe("");
  });

  it("文件失败保留已有列表，旧成功不能清除最新错误", async () => {
    let resolveOld!: (files: { path: string }[]) => void;
    api.opencodeSessions.mockResolvedValue({ port: 4096, sessions: [] });
    api.recentSessions
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve;
        })
      )
      .mockRejectedValueOnce(new Error("private path"));
    useStore.setState({ sessionFiles: [{ path: "saved.jsonl" }] as never });
    const first = useStore.getState().refreshAi();
    await useStore.getState().refreshAi();
    expect(useStore.getState().sessionFiles).toEqual([{ path: "saved.jsonl" }]);
    expect(useStore.getState().sessionFilesErr).toBeTruthy();
    expect(useStore.getState().sessionFilesErr).not.toContain("private path");
    resolveOld([{ path: "old.jsonl" }]);
    await first;
    expect(useStore.getState().sessionFiles).toEqual([{ path: "saved.jsonl" }]);
    expect(useStore.getState().sessionFilesErr).toBeTruthy();
  });

  it("opencode 不可用时只记 sessionsErr，不影响本地会话文件", async () => {
    api.opencodeSessions.mockRejectedValue(new Error("ECONNREFUSED"));
    api.recentSessions.mockResolvedValue([{ path: "a.jsonl" }]);

    await useStore.getState().refreshAi();

    const s = useStore.getState();
    expect(s.sessionsErr).toContain("ECONNREFUSED");
    expect(s.sessions).toEqual([]);
    expect(s.sessionFiles).toHaveLength(1);
  });

  it("成功时清空上次错误", async () => {
    useStore.setState({ sessionsErr: "old" });
    api.opencodeSessions.mockResolvedValue({ port: 5000, sessions: [{ id: "s1" }] });
    api.recentSessions.mockResolvedValue([]);

    await useStore.getState().refreshAi();

    const s = useStore.getState();
    expect(s.sessionsErr).toBe("");
    expect(s.opencodePort).toBe(5000);
  });
});

describe("loadSessionDetail", () => {
  it("失败时构造一个带 error 的占位详情，而不是留空", async () => {
    api.opencodeSessionDetail.mockRejectedValue(new Error("timeout"));

    await useStore.getState().loadSessionDetail(4096, "sess-1");

    const d = useStore.getState().sessionDetail;
    expect(d?.id).toBe("sess-1");
    expect(d?.error).toContain("timeout");
    expect(useStore.getState().sessionDetailLoading).toBe(false);
  });

  it("成功时写入详情", async () => {
    api.opencodeSessionDetail.mockResolvedValue({ id: "sess-1", title: "T" });
    await useStore.getState().loadSessionDetail(4096, "sess-1");
    expect(useStore.getState().sessionDetail?.title).toBe("T");
  });
});

describe("fetchGitBranch", () => {
  it("同一目录只探测一次（缓存）", async () => {
    api.gitBranch.mockResolvedValue("main");
    const a = await useStore.getState().fetchGitBranch("C:\\p");
    const b = await useStore.getState().fetchGitBranch("C:\\p");
    expect(a).toBe("main");
    expect(b).toBe("main");
    expect(api.gitBranch).toHaveBeenCalledTimes(1);
  });

  it("探测失败缓存空串，不反复重试", async () => {
    api.gitBranch.mockRejectedValue(new Error("no repo"));
    expect(await useStore.getState().fetchGitBranch("C:\\p")).toBe("");
    expect(await useStore.getState().fetchGitBranch("C:\\p")).toBe("");
    expect(api.gitBranch).toHaveBeenCalledTimes(1);
  });
});

describe("killProcess / openTarget", () => {
  it("终止成功清空 killTarget 并触发刷新", async () => {
    api.terminateProcess.mockResolvedValue(undefined);
    api.listProcesses.mockResolvedValue([]);
    api.listPorts.mockResolvedValue([]);
    api.listDevServers.mockResolvedValue([]);
    api.listAiProcesses.mockResolvedValue([]);
    api.systemInfo.mockResolvedValue(null);
    api.diskInfo.mockResolvedValue([]);
    useStore.setState({ killTarget: proc() as never });

    await useStore.getState().killProcess(1);
    await new Promise((r) => setTimeout(r, 20));

    expect(useStore.getState().killTarget).toBeNull();
    expect(useStore.getState().toast).toContain("1");
  });

  it("终止失败保留 killTarget 并提示", async () => {
    api.terminateProcess.mockRejectedValue(new Error("denied"));
    useStore.setState({ killTarget: proc() as never });

    await useStore.getState().killProcess(1);

    expect(useStore.getState().killTarget).not.toBeNull();
    expect(useStore.getState().toast).toContain("denied");
  });

  it("打开目标失败转成 toast 而不是未处理的 Promise 拒绝", async () => {
    api.openExternal.mockRejectedValue(new Error("no handler"));
    await useStore.getState().openTarget("C:\\gone");
    expect(useStore.getState().toast).toContain("no handler");
  });
});

describe("成本动作", () => {
  it("扫描成功写入三个视图并报告耗时", async () => {
    api.scanSessionCosts.mockResolvedValue({
      total_scanned: 3,
      overview: { today_cost: 1 },
      trend: [],
      model_breakdown: [],
    });
    await useStore.getState().scanCosts();
    const s = useStore.getState();
    expect(s.costOverview).toEqual({ today_cost: 1 });
    expect(s.costLoading).toBe(false);
    expect(s.toast).toBeTruthy();
  });

  it("扫描进行中再次调用直接返回：不并发触发第二次 IPC，结束后可再扫描", async () => {
    let resolveScan!: (v: unknown) => void;
    api.scanSessionCosts.mockReturnValue(
      new Promise((resolve) => {
        resolveScan = resolve;
      })
    );

    const first = useStore.getState().scanCosts();
    expect(useStore.getState().costLoading).toBe(true);

    // 价格保存后用户重复点「扫描」不应叠一次全量扫描
    const second = useStore.getState().scanCosts();
    expect(api.scanSessionCosts).toHaveBeenCalledTimes(1);
    // 重入调用也不能提前把 loading 清掉（按钮会闪回可点状态）
    expect(useStore.getState().costLoading).toBe(true);

    resolveScan({
      total_scanned: 1,
      overview: { today_cost: 1 },
      trend: [],
      model_breakdown: [],
    });
    await Promise.all([first, second]);
    expect(useStore.getState().costLoading).toBe(false);

    // 防重入不是永久锁：上一次结束后新调用照常执行
    api.scanSessionCosts.mockResolvedValue({
      total_scanned: 0,
      overview: { today_cost: 2 },
      trend: [],
      model_breakdown: [],
    });
    await useStore.getState().scanCosts();
    expect(api.scanSessionCosts).toHaveBeenCalledTimes(2);
    expect(useStore.getState().costOverview).toEqual({ today_cost: 2 });
  });

  it("loading 订阅者同步请求补扫时不会丢失请求", async () => {
    let finish!: (value: unknown) => void;
    api.scanSessionCosts
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        })
      )
      .mockResolvedValueOnce({
        total_scanned: 1,
        overview: { today_cost: 2 },
        trend: [],
        model_breakdown: [],
      });
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (state.costLoading && !previous.costLoading) {
        void state.scanCosts({ afterCurrent: true });
      }
    });
    try {
      const scan = useStore.getState().scanCosts();
      expect(api.scanSessionCosts).toHaveBeenCalledTimes(1);
      finish({
        total_scanned: 1,
        overview: { today_cost: 1 },
        trend: [],
        model_breakdown: [],
      });
      await scan;
      expect(api.scanSessionCosts).toHaveBeenCalledTimes(2);
      expect(useStore.getState().costOverview).toEqual({ today_cost: 2 });
      expect(useStore.getState().costLoading).toBe(false);
    } finally {
      unsubscribe();
    }
  });

  it("价格多次变更合并补扫，补扫期间变更再补一次且手工重入不排队", async () => {
    const resolvers: ((v: unknown) => void)[] = [];
    api.scanSessionCosts.mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve))
    );
    const result = (cost: number) => ({
      total_scanned: 1,
      overview: { today_cost: cost },
      trend: [],
      model_breakdown: [],
    });
    const first = useStore.getState().scanCosts();
    void useStore.getState().scanCosts({ afterCurrent: true });
    void useStore.getState().scanCosts({ afterCurrent: true });
    void useStore.getState().scanCosts();
    expect(resolvers).toHaveLength(1);
    resolvers[0](result(1));
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    expect(useStore.getState().costLoading).toBe(true);
    void useStore.getState().scanCosts({ afterCurrent: true });
    void useStore.getState().scanCosts({ afterCurrent: true });
    resolvers[1](result(2));
    await vi.waitFor(() => expect(resolvers).toHaveLength(3));
    resolvers[2](result(3));
    await first;
    expect(useStore.getState().costOverview).toEqual({ today_cost: 3 });
    expect(useStore.getState().costLoading).toBe(false);
    expect(api.scanSessionCosts).toHaveBeenCalledTimes(3);
  });

  it("旧扫描失败后仍补扫，补扫失败可见且不会无限重试", async () => {
    let rejectFirst!: (reason: Error) => void;
    api.scanSessionCosts
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        })
      )
      .mockRejectedValueOnce(new Error("rescan failed"));
    api.getCostOverview.mockResolvedValue(null);
    api.getCostTrend.mockResolvedValue([]);
    api.getModelBreakdown.mockResolvedValue([]);
    api.getCostSettings.mockResolvedValue(useStore.getState().costSettings);
    const first = useStore.getState().scanCosts();
    void useStore.getState().scanCosts({ afterCurrent: true });
    rejectFirst(new Error("initial failed"));
    await first;
    expect(api.scanSessionCosts).toHaveBeenCalledTimes(2);
    expect(useStore.getState().toast).toContain("rescan failed");
    expect(useStore.getState().costLoading).toBe(false);
  });

  it("扫描部分提交后失败时重新读取成本视图并保留扫描错误", async () => {
    const overview = { today_cost: 7 };
    const trend = [{ date: "2026-01-01", cost: 7 }];
    const breakdown = [{ model: "test", cost: 7 }];
    useStore.setState({ costOverview: { today_cost: 1 } as never });
    api.scanSessionCosts.mockImplementation(async () => {
      api.getCostOverview.mockResolvedValue(overview);
      api.getCostTrend.mockResolvedValue(trend);
      api.getModelBreakdown.mockResolvedValue(breakdown);
      api.getCostSettings.mockResolvedValue(useStore.getState().costSettings);
      throw new Error("scan boom");
    });
    await useStore.getState().scanCosts();
    expect(useStore.getState().costOverview).toEqual(overview);
    expect(useStore.getState().costTrend).toEqual(trend);
    expect(useStore.getState().costModelBreakdown).toEqual(breakdown);
    expect(useStore.getState().costLoading).toBe(false);
    expect(useStore.getState().toast).toContain("scan boom");
  });

  it("扫描和重新读取都失败时保留可见的两种错误并结束 loading", async () => {
    api.scanSessionCosts.mockRejectedValue(new Error("scan boom"));
    api.getCostOverview.mockRejectedValue(new Error("read boom"));
    api.getCostTrend.mockResolvedValue([]);
    api.getModelBreakdown.mockResolvedValue([]);
    api.getCostSettings.mockResolvedValue(useStore.getState().costSettings);
    await useStore.getState().scanCosts();
    expect(useStore.getState().costLoading).toBe(false);
    expect(useStore.getState().toast).toContain("scan boom");
    expect(useStore.getState().toast).toContain("read boom");
  });

  it("保存成本设置成功才更新内存态", async () => {
    api.saveCostSettings.mockResolvedValue(undefined);
    api.getCostOverview.mockResolvedValue(null);
    api.getCostTrend.mockResolvedValue([]);
    api.getModelBreakdown.mockResolvedValue([]);
    api.getCostSettings.mockResolvedValue({ daily_budget: 9 });

    const ok = await useStore.getState().updateCostSettings({ daily_budget: 9 } as never);

    expect(ok).toBe(true);
    expect(useStore.getState().costSettings.daily_budget).toBe(9);
  });

  it("保存成本设置失败返回 false 且不改内存态", async () => {
    const before = useStore.getState().costSettings;
    api.saveCostSettings.mockRejectedValue(new Error("disk full"));
    const ok = await useStore
      .getState()
      .updateCostSettings({ daily_budget: 99 } as never);
    expect(ok).toBe(false);
    expect(useStore.getState().costSettings).toEqual(before);
  });

  it("读取成本总览时多个接口失败只提示第一条并带总数", async () => {
    api.getCostOverview.mockRejectedValue(new Error("A"));
    api.getCostTrend.mockRejectedValue(new Error("B"));
    api.getModelBreakdown.mockRejectedValue(new Error("C"));
    api.getCostSettings.mockResolvedValue(useStore.getState().costSettings);

    await useStore.getState().loadCostOverview();

    const toast = useStore.getState().toast;
    expect(toast).toContain("A");
    expect(toast).toContain("+2");
  });

  it("清空成本数据重置视图与通知位", async () => {
    api.clearCostRecords.mockResolvedValue(undefined);
    useStore.setState({ costNotified: true, costOverview: {} as never });
    await useStore.getState().clearCosts();
    const s = useStore.getState();
    expect(s.costOverview).toBeNull();
    expect(s.costNotified).toBe(false);
  });
});

describe("预算告警", () => {
  it("超过阈值只通知一次，回落后重置", async () => {
    api.ensureNotificationPermission.mockResolvedValue(true);
    api.notify.mockResolvedValue(undefined);
    useStore.setState({
      costOverview: {
        daily_budget: 10,
        monthly_budget: 0,
        daily_pct: 90,
        monthly_pct: 0,
        alert_threshold_pct: 80,
      } as never,
    });

    useStore.getState().checkBudgetAlert();
    useStore.getState().checkBudgetAlert();
    await new Promise((r) => setTimeout(r, 10));
    expect(api.notify).toHaveBeenCalledTimes(1);
    expect(useStore.getState().costNotified).toBe(true);

    // 回落到阈值以下 → 允许下次再提醒
    useStore.setState({
      costOverview: { ...useStore.getState().costOverview!, daily_pct: 10 } as never,
    });
    useStore.getState().checkBudgetAlert();
    expect(useStore.getState().costNotified).toBe(false);
  });

  it("没有通知权限时不发通知（避免静默失败）", async () => {
    api.ensureNotificationPermission.mockResolvedValue(false);
    useStore.setState({
      costOverview: {
        daily_budget: 10,
        monthly_budget: 0,
        daily_pct: 99,
        monthly_pct: 0,
        alert_threshold_pct: 80,
      } as never,
    });
    useStore.getState().checkBudgetAlert();
    await new Promise((r) => setTimeout(r, 10));
    expect(api.notify).not.toHaveBeenCalled();
  });
});

/**
 * 剩余未覆盖分支：项目 CRUD 的持久化路径、成本设置读取失败、清空失败。
 * 这些分支原先靠人工点击验证，回归时只会表现为「数据没保存」，
 * 是最难发现的一类。
 */
describe("数据重载与持久化", () => {
  beforeEach(async () => {
    api.restoreBackup.mockResolvedValue({
      safety_backup: "fixture",
      restored: [],
      untouched: [],
    });
    api.loadDataVersioned.mockResolvedValue({
      data: { projects: [], tasks: [] },
      generation: "0",
    });
    await useStore.getState().restoreData("20261101-000000");
    api.saveData.mockClear();
  });

  it("updateProject 只改目标项目", () => {
    useStore.setState({
      data: {
        projects: [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ] as never,
        tasks: [],
      },
    });
    useStore.getState().updateProject("b", { name: "B2" });
    const p = useStore.getState().data.projects;
    expect(p[0].name).toBe("A");
    expect(p[1].name).toBe("B2");
  });

  it("deleteProject 同时解除任务的项目关联", () => {
    useStore.setState({
      data: {
        projects: [{ id: "a" }, { id: "b" }] as never,
        tasks: [{ id: "t1", project_id: "a", title: "T" }] as never,
      },
    });
    useStore.getState().deleteProject("a");
    const s = useStore.getState();
    expect(s.data.projects.map((p) => p.id)).toEqual(["b"]);
    expect(s.data.tasks[0].project_id).toBeNull();
  });

  it("persistData 在桌面模式下防抖写入，连续调用只写一次", async () => {
    vi.useFakeTimers();
    api.saveData.mockResolvedValue(undefined);
    useStore.getState().persistData({ projects: [], tasks: [] });
    useStore.getState().persistData({ projects: [{ id: "x" }] as never, tasks: [] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.saveData).toHaveBeenCalledTimes(1);
    expect(api.saveData.mock.calls[0][0].projects[0].id).toBe("x");
    vi.useRealTimers();
  });

  it("persistData 写盘失败时提示用户", async () => {
    vi.useFakeTimers();
    api.saveData.mockRejectedValue(new Error("readonly"));
    useStore.getState().persistData({ projects: [], tasks: [] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(useStore.getState().toast).toContain("readonly");
    vi.useRealTimers();
  });
});

describe("成本的失败分支", () => {
  it("读取成本设置失败时提示", async () => {
    api.getCostSettings.mockRejectedValue(new Error("no settings"));
    await useStore.getState().loadCostSettings();
    expect(useStore.getState().toast).toContain("no settings");
  });

  it("清空成本失败时提示且不清空视图", async () => {
    useStore.setState({ costOverview: { record_count: 3 } as never });
    api.clearCostRecords.mockRejectedValue(new Error("locked"));
    await useStore.getState().clearCosts();
    expect(useStore.getState().toast).toContain("locked");
    expect(useStore.getState().costOverview).not.toBeNull();
  });

  it("setAlwaysOnTop / setKillTarget 直接写入", () => {
    useStore.getState().setAlwaysOnTop(true);
    expect(useStore.getState().alwaysOnTop).toBe(true);
    useStore.getState().setKillTarget(proc() as never);
    expect(useStore.getState().killTarget?.pid).toBe(1);
    useStore.getState().setKillTarget(null);
    expect(useStore.getState().killTarget).toBeNull();
  });
});

// 回归护栏：UI 持久化（workbench-ui-v1）不得包含 view 字段。
// view 只存内存态、每次启动落在默认页 —— 否则一旦持久化了某个后来被删除的
// 页面 key（如已移除的 agent），下次启动 PAGE_COMPONENTS[view] 会取到
// undefined，整个应用白屏。本用例锁死「partialize 永不收录 view」这一约束。
describe("UI 持久化边界", () => {
  it("持久化快照不包含 view（视图从不跨启动恢复）", () => {
    useStore.getState().setView("tasks");
    expect(useStore.getState().view).toBe("tasks");
    const raw = localStorage.getItem("workbench-ui-v1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { state?: Record<string, unknown> };
    expect(parsed.state).toBeDefined();
    expect("view" in parsed.state!).toBe(false);
  });
});
