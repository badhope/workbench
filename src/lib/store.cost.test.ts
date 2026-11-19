import { describe, expect, it, vi } from "vitest";
import { api, harness, proc } from "./storeTestHarness";
import { installStoreTestReset, useStore } from "./storeTestBootstrap";

vi.mock("./api", async () => (await import("./storeTestMock")).apiModule());

installStoreTestReset();

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
      api.getCostTrendExtended.mockResolvedValue({
        days: 14,
        daily: trend,
        monthly: [],
      });
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
    api.getCostTrendExtended.mockRejectedValue(new Error("B"));
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
    expect(s.costProjectBreakdown).toEqual([]);
    expect(s.costTrendMonthly).toEqual([]);
  });

  it("loadCostTrend 切换窗口：日粒度与月度桶一起更新", async () => {
    api.getCostTrendExtended.mockResolvedValue({
      days: 90,
      daily: [{ day: "2026-03-01", cost: 1 }],
      monthly: [{ month: "2026-01", cost: 9 }],
    });
    await useStore.getState().loadCostTrend(90);
    expect(useStore.getState().costTrendDays).toBe(90);
    expect(useStore.getState().costTrend).toEqual([{ day: "2026-03-01", cost: 1 }]);
    expect(useStore.getState().costTrendMonthly).toEqual([{ month: "2026-01", cost: 9 }]);
  });

  it("loadCostTrend 失败时提示且不改窗口天数", async () => {
    useStore.setState({ costTrendDays: 30 });
    api.getCostTrendExtended.mockRejectedValue(new Error("db locked"));
    await useStore.getState().loadCostTrend(90);
    expect(useStore.getState().costTrendDays).toBe(30);
    expect(useStore.getState().toast).toContain("db locked");
  });

  it("演示模式下 loadCostTrend 只切窗口，不发请求", async () => {
    harness.tauriMode = false;
    await useStore.getState().loadCostTrend(30);
    expect(useStore.getState().costTrendDays).toBe(30);
    expect(api.getCostTrendExtended).not.toHaveBeenCalled();
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
