import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * IPC 包装层：验证每个函数把正确的命令名与参数形状传给 invoke。
 *
 * 为什么值得测：这些函数本身只有一行，但「命令名拼错」「参数名写成
 * snake_case 而 Tauri 需要 camelCase」在类型层面看不出来，运行时才报错。
 * 这里用 mock 捕获真实调用，比读代码可靠。
 */
const invokeMock = vi.fn(async (..._args: unknown[]) => undefined as unknown);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invokeMock(...a),
}));

// 桌面端分支会动态 import 这两个插件；在 jsdom 里它们会去调 IPC。
const permissionGranted = vi.fn(async () => true);
const requestPermission = vi.fn(async () => "granted");
const sendNotification = vi.fn((_arg: unknown) => {});
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: () => permissionGranted(),
  requestPermission: () => requestPermission(),
  sendNotification,
}));
const openUrl = vi.fn(async (_url: string) => {});
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl,
}));

const api = await import("./api");

beforeEach(() => {
  invokeMock.mockClear();
});

describe("命令名与参数", () => {
  it("进程：list_processes / terminate_process(pid)", async () => {
    await api.listProcesses();
    expect(invokeMock).toHaveBeenLastCalledWith("list_processes");

    await api.terminateProcess(4321);
    expect(invokeMock).toHaveBeenLastCalledWith("terminate_process", { pid: 4321 });
  });

  it("端口与服务：无参数命令", async () => {
    await api.listPorts();
    expect(invokeMock).toHaveBeenLastCalledWith("list_ports");
    await api.listDevServers();
    expect(invokeMock).toHaveBeenLastCalledWith("list_dev_servers");
    await api.listAiProcesses();
    expect(invokeMock).toHaveBeenLastCalledWith("list_ai_processes");
  });

  it("会话详情用 camelCase 的 sessionId", async () => {
    await api.opencodeSessionDetail(4096, "sess-1");
    expect(invokeMock).toHaveBeenLastCalledWith("opencode_session_detail", {
      port: 4096,
      sessionId: "sess-1",
    });
  });

  it("数据读写", async () => {
    const requiresGeneration: Parameters<typeof api.saveData> extends [unknown, string]
      ? true
      : false = true;
    expect(requiresGeneration).toBe(true);
    await api.loadData();
    expect(invokeMock).toHaveBeenLastCalledWith("load_data");
    const data = { projects: [], tasks: [] };
    await api.loadDataVersioned();
    expect(invokeMock).toHaveBeenLastCalledWith("load_data_versioned");
    await api.saveData(data, "12");
    expect(invokeMock).toHaveBeenLastCalledWith("save_data", { data, generation: "12" });
  });

  it("git 分支", async () => {
    await api.gitBranch("C:\\proj");
    expect(invokeMock).toHaveBeenLastCalledWith("git_branch", { dir: "C:\\proj" });
  });

  it("成本相关", async () => {
    await api.scanSessionCosts();
    expect(invokeMock).toHaveBeenLastCalledWith("scan_session_costs");
    await api.getCostOverview();
    expect(invokeMock).toHaveBeenLastCalledWith("get_cost_overview");
    await api.getCostTrend(7);
    expect(invokeMock).toHaveBeenLastCalledWith("get_cost_trend", { days: 7 });
    await api.getModelBreakdown();
    expect(invokeMock).toHaveBeenLastCalledWith("get_model_breakdown");
    await api.clearCostRecords();
    expect(invokeMock).toHaveBeenLastCalledWith("clear_cost_records");
  });

  it("成本设置透传完整对象", async () => {
    const settings = {
      daily_budget: 5,
      monthly_budget: 50,
      alert_threshold_pct: 80,
      include_estimated: true,
    };
    await api.saveCostSettings(settings);
    expect(invokeMock).toHaveBeenLastCalledWith("save_cost_settings_cmd", { settings });
  });

  it("定价读写（新增能力）", async () => {
    await api.getPricing();
    expect(invokeMock).toHaveBeenLastCalledWith("get_pricing");
    await api.savePricing({ "gpt-4o": [1, 2] });
    expect(invokeMock).toHaveBeenLastCalledWith("save_pricing", {
      overrides: { "gpt-4o": [1, 2] },
    });
  });

  it("备份", async () => {
    await api.backupData();
    expect(invokeMock).toHaveBeenLastCalledWith("backup_data");
    await api.openBackupDir();
    expect(invokeMock).toHaveBeenLastCalledWith("open_backup_dir");
  });

  it("日志读取按行数传参", async () => {
    await api.readLogs(200);
    expect(invokeMock).toHaveBeenLastCalledWith("read_logs", { maxLines: 200 });
  });

  it("系统信息与磁盘", async () => {
    await api.systemInfo();
    expect(invokeMock).toHaveBeenLastCalledWith("system_info");
    await api.diskInfo();
    expect(invokeMock).toHaveBeenLastCalledWith("disk_info");
  });

  it("置顶开关", async () => {
    await api.setAlwaysOnTop(true);
    expect(invokeMock).toHaveBeenLastCalledWith("set_always_on_top", { on: true });
  });

  // 会话/日志/设置这三组命令原先只有调用点、没有契约测试：
  // 命令名一旦与 Rust 的 `#[tauri::command]` 拼写不一致，
  // 只有真机点开对应页面才会报 "command not found"。
  it("会话与日志", async () => {
    await api.opencodeSessions();
    expect(invokeMock).toHaveBeenLastCalledWith("opencode_sessions");
    await api.recentSessions();
    expect(invokeMock).toHaveBeenLastCalledWith("recent_sessions_preview");
    await api.clearLogs();
    expect(invokeMock).toHaveBeenLastCalledWith("clear_logs");
  });

  it("成本设置读取命令带 _cmd 后缀", async () => {
    await api.getCostSettings();
    expect(invokeMock).toHaveBeenLastCalledWith("get_cost_settings_cmd");
  });
});

describe("openExternal 分类", () => {
  it("路径走 open_known_path（不是 opener 插件：必须过白名单）", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    await api.openExternal("C:\\proj");
    expect(invokeMock).toHaveBeenLastCalledWith("open_known_path", { path: "C:\\proj" });
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("空串不触碰 IPC", async () => {
    invokeMock.mockClear();
    await api.openExternal("   ");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("不支持的协议抛错而不是静默", async () => {
    await expect(api.openExternal("javascript:alert(1)")).rejects.toThrow(/不支持/);
  });
});

describe("备份与定价的新增命令", () => {
  it("list_backups 无参数、restore_backup 传 id", async () => {
    await api.listBackups();
    expect(invokeMock).toHaveBeenLastCalledWith("list_backups");
    await api.restoreBackup("20261022-101010");
    expect(invokeMock).toHaveBeenLastCalledWith("restore_backup", {
      id: "20261022-101010",
    });
  });
});

describe("通知", () => {
  it("浏览器下未授权时不发送", async () => {
    const perm = vi.fn();
    vi.stubGlobal("Notification", perm);
    Object.defineProperty(perm, "permission", { value: "denied", writable: true });
    await api.notify("t", "b");
    expect(invokeMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("浏览器下已授权时走 Notification 构造", async () => {
    const Ctor = vi.fn();
    Object.defineProperty(Ctor, "permission", { value: "granted", writable: true });
    vi.stubGlobal("Notification", Ctor);
    await api.notify("标题", "内容");
    expect(Ctor).toHaveBeenCalledWith("标题", expect.objectContaining({ body: "内容" }));
    vi.unstubAllGlobals();
  });

  it("没有 Notification 全局时安全返回 false", async () => {
    vi.stubGlobal("Notification", undefined);
    expect(await api.ensureNotificationPermission()).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("openExternal 的 URL 分支（浏览器）", () => {
  it("http 链接在非 Tauri 下用 window.open", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    await api.openExternal("https://example.com");
    expect(open).toHaveBeenCalledWith("https://example.com", "_blank", "noopener");
    vi.unstubAllGlobals();
  });
});

describe("isTauri", () => {
  it("没有 __TAURI_INTERNALS__ 时为 false", () => {
    expect(api.isTauri()).toBe(false);
  });

  it("注入了 __TAURI_INTERNALS__ 时为 true", () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    expect(api.isTauri()).toBe(true);
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });
});

describe("桌面端插件分支", () => {
  beforeEach(() => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    openUrl.mockClear();
    sendNotification.mockClear();
    permissionGranted.mockClear();
    requestPermission.mockClear();
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("http 链接走 opener 插件而不是 window.open", async () => {
    const winOpen = vi.fn();
    vi.stubGlobal("open", winOpen);
    await api.openExternal("https://example.com/x");
    expect(openUrl).toHaveBeenCalledWith("https://example.com/x");
    expect(winOpen).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("已授权时不再申请权限", async () => {
    expect(await api.ensureNotificationPermission()).toBe(true);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("未授权时申请并返回结果", async () => {
    permissionGranted.mockResolvedValueOnce(false);
    requestPermission.mockResolvedValueOnce("denied");
    expect(await api.ensureNotificationPermission()).toBe(false);
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("插件抛错时降级为 false 而不是让页面崩", async () => {
    permissionGranted.mockRejectedValueOnce(new Error("ipc down"));
    expect(await api.ensureNotificationPermission()).toBe(false);
  });

  it("桌面端通知走 sendNotification", async () => {
    await api.notify("标题", "正文");
    expect(sendNotification).toHaveBeenCalledWith({ title: "标题", body: "正文" });
  });
});

/**
 * HTTP 传输分支：同一批函数在浏览器里连着 `workbench serve` 时走 REST。
 *
 * 这些用例的价值不在「调了 fetch」，而在三点：
 * 1) 路径与查询参数正确（写错就是 404，而 UI 只会显示"加载失败"）；
 * 2) 桌面独占的不可逆操作必须明确拒绝，而不是悄悄发请求；
 * 3) 后端语义差异（opencode 的 available:false）被归一化成调用方熟悉的形式。
 */
describe("HTTP 传输分支", () => {
  const fetchMock = vi.fn();

  beforeEach(async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    const { __resetTransportForTests } = await import("./transport");
    __resetTransportForTests();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    // 让探测判定为 http
    await (await import("./transport")).detectTransport();
  });

  afterEach(async () => {
    const { __resetTransportForTests } = await import("./transport");
    __resetTransportForTests();
    vi.unstubAllGlobals();
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  it("进程与端口走对应 REST 路径", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    }));
    await api.listProcesses();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/processes");
    await api.listPorts();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/ports");
    await api.listDevServers();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/dev-servers");
    await api.listAiProcesses();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/ai-processes");
  });

  it("成本趋势把 days 放进查询串而不是 body", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    }));
    await api.getCostTrend(30);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/cost/trend?days=30");
    await api.getCostTrendExtended(7);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/cost/trend-extended?days=7");
  });

  it("保存数据用 PUT 且带 JSON body", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }));
    const data = { projects: [], tasks: [] };
    await api.saveData(data, "http");
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/data");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual(data);
  });

  it("桌面独占的不可逆操作在 Web 模式明确报错，且不发请求", async () => {
    const before = fetchMock.mock.calls.length;
    await expect(api.terminateProcess(1234)).rejects.toThrow(/桌面应用/);
    await expect(api.terminateProcessElevated(1234)).rejects.toThrow(/桌面应用/);
    await expect(api.clearCostRecords()).rejects.toThrow(/桌面应用/);
    await expect(api.readLogs(10)).rejects.toThrow(/桌面应用/);
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("opencode 未运行时把 available:false 归一化成抛错", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        port: 4096,
        available: false,
        sessions: [],
        error: "未检测到运行中的 opencode 服务",
      }),
    }));
    await expect(api.opencodeSessions()).rejects.toThrow(/opencode/);
  });

  it("opencode 可用时返回 port 与 sessions", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        port: 4200,
        available: true,
        sessions: [{ id: "s1" }],
        error: null,
      }),
    }));
    const res = await api.opencodeSessions();
    expect(res.port).toBe(4200);
    expect(res.sessions).toHaveLength(1);
  });

  it("保存成本设置用 PUT /api/cost/settings", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }));
    await api.saveCostSettings({
      daily_budget: 5,
      monthly_budget: 50,
      alert_threshold_pct: 80,
      include_estimated: true,
    });
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/cost/settings");
    expect(init.method).toBe("PUT");
  });

  it("扫描成本用 POST /api/cost/scan", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ new_records: 0 }),
    }));
    await api.scanSessionCosts();
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/cost/scan");
    expect(init.method).toBe("POST");
  });

  it("诊断与系统信息走 GET", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    await api.runDiagnostics();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/diagnostics");
    await api.systemInfo();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/system");
    await api.diskInfo();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/disks");
  });
});
