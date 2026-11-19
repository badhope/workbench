import { describe, expect, it, vi } from "vitest";
import { api, harness, proc } from "./storeTestHarness";
import { installStoreTestReset, useStore } from "./storeTestBootstrap";

vi.mock("./api", async () => (await import("./storeTestMock")).apiModule());

installStoreTestReset();

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
    harness.tauriMode = false;
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

    await useStore.getState().killProcess(proc());
    await new Promise((r) => setTimeout(r, 20));

    expect(api.terminateProcess).toHaveBeenCalledWith(1, "node.exe", 1);
    expect(useStore.getState().killTarget).toBeNull();
    expect(useStore.getState().toast).toContain("1");
  });

  it("终止失败保留 killTarget 并提示", async () => {
    api.terminateProcess.mockRejectedValue(new Error("denied"));
    useStore.setState({ killTarget: proc() as never });

    await useStore.getState().killProcess(proc());

    expect(useStore.getState().killTarget).not.toBeNull();
    expect(useStore.getState().toast).toContain("denied");
  });

  it("打开目标失败转成 toast 而不是未处理的 Promise 拒绝", async () => {
    api.openExternal.mockRejectedValue(new Error("no handler"));
    await useStore.getState().openTarget("C:\\gone");
    expect(useStore.getState().toast).toContain("no handler");
  });
});
