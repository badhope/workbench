import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "./store";
import type { Project, Task } from "../types";
import { setLang } from "./i18n";

// 锁定界面语言：toast / 默认名文案按中文断言（默认语言是英语）
setLang("zh");

// 整个文件测的是**浏览器（无后端）语义**：项目/任务的内存态、演示模式守卫。
// 显式去掉桌面标记，而不是依赖全局默认值——默认值一旦改，这里的断言就失去意义。
delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;

/** 测试隔离：每个用例前把 store 重置到已知状态（浏览器模式下不触发 IPC）。 */
function resetStore() {
  useStore.setState({
    data: { projects: [], tasks: [] },
    toast: "",
    killTarget: null,
  });
}

const proj = (over: Partial<Project> = {}): Project => ({
  id: "p1",
  name: "项目一",
  path: "C:\\proj\\one",
  status: "active",
  tags: [],
  pinned: false,
  note: "",
  created_at: 1_700_000_000,
  ...over,
});

const task = (over: Partial<Task> = {}): Task => ({
  id: "t1",
  title: "任务一",
  status: "todo",
  priority: "normal",
  due: null,
  project_id: null,
  tags: [],
  created_at: 1_700_000_000,
  updated_at: 1_700_000_000,
  ...over,
});

describe("store 任务操作", () => {
  beforeEach(resetStore);

  it("addTask 补全默认字段并插入队首", () => {
    useStore.getState().addTask({ title: "  写文档  " });
    const tasks = useStore.getState().data.tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("写文档");
    expect(tasks[0].status).toBe("todo");
    expect(tasks[0].priority).toBe("normal");
    expect(tasks[0].id).toBeTruthy();
  });

  it("addTask 空标题回退为未命名任务", () => {
    useStore.getState().addTask({ title: "   " });
    expect(useStore.getState().data.tasks[0].title).toBe("未命名任务");
  });

  it("updateTask 只改目标并刷新 updated_at", () => {
    useStore.setState({ data: { projects: [], tasks: [task()] } });
    useStore.getState().updateTask("t1", { status: "doing", priority: "high" });
    const t = useStore.getState().data.tasks[0];
    expect(t.status).toBe("doing");
    expect(t.priority).toBe("high");
    expect(t.created_at).toBe(1_700_000_000);
    expect(t.updated_at).toBeGreaterThanOrEqual(t.created_at);
  });

  it("updateTask 不存在的 id 无副作用", () => {
    useStore.setState({ data: { projects: [], tasks: [task()] } });
    useStore.getState().updateTask("ghost", { status: "done" });
    expect(useStore.getState().data.tasks[0].status).toBe("todo");
  });

  it("moveTask 等价于 updateTask 的 status 补丁", () => {
    useStore.setState({ data: { projects: [], tasks: [task()] } });
    useStore.getState().moveTask("t1", "done");
    expect(useStore.getState().data.tasks[0].status).toBe("done");
  });

  it("deleteTask 精确移除", () => {
    useStore.setState({
      data: { projects: [], tasks: [task({ id: "a" }), task({ id: "b" })] },
    });
    useStore.getState().deleteTask("a");
    expect(useStore.getState().data.tasks.map((t) => t.id)).toEqual(["b"]);
  });
});

describe("store 项目操作", () => {
  beforeEach(resetStore);

  it("addProject 默认值与置顶排序无关（排序在视图层）", () => {
    useStore.getState().addProject({ name: "新项目", path: "D:\\x" });
    const p = useStore.getState().data.projects[0];
    expect(p.name).toBe("新项目");
    expect(p.status).toBe("active");
    expect(p.pinned).toBe(false);
    expect(p.tags).toEqual([]);
  });

  it("deleteProject 解除任务关联而不删除任务", () => {
    useStore.setState({
      data: {
        projects: [proj({ id: "p1" })],
        tasks: [task({ project_id: "p1" }), task({ id: "t2", project_id: null })],
      },
    });
    useStore.getState().deleteProject("p1");
    const { projects, tasks } = useStore.getState().data;
    expect(projects).toHaveLength(0);
    expect(tasks).toHaveLength(2); // 任务保留
    expect(tasks[0].project_id).toBeNull(); // 关联解除
  });

  it("persistData 同步更新内存状态（磁盘写入在桌面端防抖）", () => {
    useStore.getState().persistData({ projects: [proj()], tasks: [task()] });
    expect(useStore.getState().data.projects).toHaveLength(1);
  });
});

describe("store UI 状态", () => {
  it("setToast 设置并在 TTL 后自动清除", async () => {
    useStore.getState().setToast("hello");
    expect(useStore.getState().toast).toBe("hello");
  });

  it("setView / setRefreshMs 生效", () => {
    useStore.getState().setView("tasks");
    useStore.getState().setRefreshMs(5000);
    expect(useStore.getState().view).toBe("tasks");
    expect(useStore.getState().refreshMs).toBe(5000);
  });

  it("checkBudgetAlert 无数据时安全返回", () => {
    expect(() => useStore.getState().checkBudgetAlert()).not.toThrow();
  });

  // 回归：浏览器演示模式（非 Tauri）下这三个成本接口原先缺守卫，
  // 直接调用会抛 "Cannot read properties of undefined (reading 'invoke')"，
  // 并被 loadCostOverview 的 track() 抓成 toast 顶到界面上（见 06-tasks 截图）。
  it("浏览器演示模式下成本三接口不抛错、不提示错误", async () => {
    useStore.setState({ toast: "", costOverview: null });
    await expect(useStore.getState().loadCostOverview()).resolves.toBeUndefined();
    await expect(useStore.getState().scanCosts()).resolves.toBeUndefined();
    await expect(useStore.getState().loadCostSettings()).resolves.toBeUndefined();
    expect(useStore.getState().toast).toBe("");
    expect(useStore.getState().costOverview).toBeNull();
  });

  // 回归：clearCosts 原先漏了同款守卫，演示模式点「清空」必现原始 TypeError toast
  it("浏览器演示模式下 clearCosts 不抛错、不提示错误", async () => {
    useStore.setState({ toast: "" });
    await expect(useStore.getState().clearCosts()).resolves.toBeUndefined();
    expect(useStore.getState().toast).toBe("");
  });

  // 回归：updateCostSettings 原先先写内存再保存，失败后内存态与磁盘脱节。
  // 演示模式下没有后端，应当返回 false 且不覆盖已加载的设置。
  it("updateCostSettings 保存失败时返回 false 且不改内存态", async () => {
    const before = useStore.getState().costSettings;
    const ok = await useStore
      .getState()
      .updateCostSettings({ ...before, daily_budget: 99 });
    expect(ok).toBe(false);
    expect(useStore.getState().costSettings).toEqual(before);
  });
});

// 刷新重入：并发调用不应被静默丢弃。原先 `if (refreshing) return` 会吞掉
// 终止进程后的补刷、手动「立即刷新」、窗口恢复时的补刷。
describe("refreshRuntime 重入", () => {
  it("并发调用复用同一在途请求并补跑一次", async () => {
    // 浏览器模式（非 Tauri）下 refreshRuntime 直接返回，这里只验证不抛错、
    // 且多次并发调用都能正常 resolve（不会互相干扰或泄漏）。
    const calls = [
      useStore.getState().refreshRuntime(),
      useStore.getState().refreshRuntime(),
      useStore.getState().refreshRuntime(),
    ];
    await expect(Promise.all(calls)).resolves.toBeDefined();
  });
});
