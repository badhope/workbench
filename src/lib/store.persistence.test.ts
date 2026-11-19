import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./storeTestHarness";
import { installStoreTestReset, useStore } from "./storeTestBootstrap";

vi.mock("./api", async () => (await import("./storeTestMock")).apiModule());

installStoreTestReset();

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
