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
  Channel: class {
    onmessage: (event: unknown) => void = () => {};
  },
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
  it("进程：list_processes / terminate_process(pid + 身份)", async () => {
    await api.listProcesses();
    expect(invokeMock).toHaveBeenLastCalledWith("list_processes");

    await api.terminateProcess(4321, "node.exe", 1700000000);
    expect(invokeMock).toHaveBeenLastCalledWith("terminate_process", {
      pid: 4321,
      expectedName: "node.exe",
      expectedStartTime: 1700000000,
    });
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

  it("本地模型助手：配置、探测、对话的命令名与参数形状", async () => {
    // 全局 setup 已注入 __TAURI_INTERNALS__；这里不要再删，否则后续用例
    // 会落到 HTTP 分支并因为相对 URL 报 Invalid URL。
    {
      const config = {
        base_url: "http://127.0.0.1:18082/v1",
        model: "minicpm5-2b",
        temperature: 0.2,
        max_tokens: 1024,
        thinking: false,
        server_bin: "",
        model_path: "",
        context_size: 8192,
      };
      await api.assistantConfig();
      expect(invokeMock).toHaveBeenLastCalledWith("assistant_config");

      await api.assistantSaveConfig(config);
      expect(invokeMock).toHaveBeenLastCalledWith("assistant_save_config", { config });

      await api.assistantStatus(config);
      expect(invokeMock).toHaveBeenLastCalledWith("assistant_status", { config });

      const messages = [{ role: "user", content: "今天先做什么？" }];
      await api.assistantChat(messages, config);
      expect(invokeMock).toHaveBeenLastCalledWith("assistant_chat", {
        messages,
        config,
      });

      await api.assistantCancel("req-1");
      expect(invokeMock).toHaveBeenLastCalledWith("assistant_cancel", {
        requestId: "req-1",
      });

      await api.assistantStartService(config);
      expect(invokeMock).toHaveBeenLastCalledWith("assistant_start_service", { config });
      await api.assistantStopService();
      expect(invokeMock).toHaveBeenLastCalledWith("assistant_stop_service");
    }
  });

  it("助手流式：Channel 事件按序送达，结束后解绑", async () => {
    const config = {
      base_url: "http://127.0.0.1:18082/v1",
      model: "minicpm5-2b",
      temperature: 0.2,
      max_tokens: 1024,
      thinking: false,
      server_bin: "",
      model_path: "",
      context_size: 8192,
    };
    const received: unknown[] = [];
    let channel: { onmessage: (event: unknown) => void } | undefined;
    invokeMock.mockImplementationOnce(async (_cmd, args) => {
      const payload = args as { onEvent: { onmessage: (event: unknown) => void } };
      channel = payload.onEvent;
      payload.onEvent.onmessage({ kind: "delta", text: "你" });
      payload.onEvent.onmessage({ kind: "done", text: "" });
      return undefined;
    });
    await api.assistantChatStream(
      [{ role: "user", content: "hi" }],
      config,
      "req-stream",
      (event) => received.push(event)
    );
    expect(invokeMock).toHaveBeenLastCalledWith("assistant_chat_stream", {
      messages: [{ role: "user", content: "hi" }],
      config,
      requestId: "req-stream",
      onEvent: expect.anything(),
    });
    expect(received).toEqual([
      { kind: "delta", text: "你" },
      { kind: "done", text: "" },
    ]);
    // 收尾必须解绑，防止迟到的帧再 patch 已结束的气泡。
    channel?.onmessage({ kind: "delta", text: "迟到" });
    expect(received).toHaveLength(2);
  });

  it("知识库：命令名、参数与只读边界", async () => {
    const status = {
      sources: [],
      doc_count: 0,
      last_indexed_at: 0,
      db_path: "/tmp/knowledge.db",
    };
    invokeMock.mockResolvedValueOnce(status);
    await api.knowledgeStatus();
    expect(invokeMock).toHaveBeenLastCalledWith("knowledge_status");

    invokeMock.mockResolvedValueOnce([]);
    await api.knowledgeSearch("笔记", 12);
    expect(invokeMock).toHaveBeenLastCalledWith("knowledge_search", {
      query: "笔记",
      limit: 12,
    });

    invokeMock.mockResolvedValueOnce({
      path: "/notes/a.md",
      title: "A",
      body: "# A",
      tags: [],
      mtime: 1,
    });
    await api.knowledgeRead("/notes/a.md");
    expect(invokeMock).toHaveBeenLastCalledWith("knowledge_read", {
      path: "/notes/a.md",
    });

    await api.knowledgeAddSource("/notes");
    expect(invokeMock).toHaveBeenLastCalledWith("knowledge_add_source", {
      path: "/notes",
    });
    await api.knowledgeRemoveSource("/notes");
    expect(invokeMock).toHaveBeenLastCalledWith("knowledge_remove_source", {
      path: "/notes",
    });
    await api.knowledgeReindex();
    expect(invokeMock).toHaveBeenLastCalledWith("knowledge_reindex");
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

  it("保存数据用 PUT 且带 JSON body、并发令牌与写入标记头", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, generation: "next-token" }),
    }));
    const data = { projects: [], tasks: [] };
    await api.saveData(data, "prev-token");
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/data");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual(data);
    const headers = init.headers as Record<string, string>;
    expect(headers["if-match"]).toBe("prev-token");
    expect(headers["x-workbench-write"]).toBe("1");
  });

  it("桌面独占的不可逆操作在 Web 模式明确报错，且不发请求", async () => {
    const before = fetchMock.mock.calls.length;
    await expect(api.terminateProcess(1234, "node.exe", 1)).rejects.toThrow(/桌面应用/);
    await expect(api.terminateProcessElevated(1234, "node.exe", 1)).rejects.toThrow(
      /桌面应用/
    );
    await expect(api.clearCostRecords()).rejects.toThrow(/桌面应用/);
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  /// 日志不再是桌面独占：Web 模式读后端同一个 workbench.log。
  it("Web 模式读日志走 GET /api/logs 并带 max_lines", async () => {
    await api.readLogs(10);
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/logs?max_lines=10");
    expect(init.method ?? "GET").toBe("GET");
  });

  /// 清空日志是写操作：Web 模式必须带写入标记头，后端才放行。
  it("Web 模式清空日志用 DELETE 且带写入标记头", async () => {
    await api.clearLogs();
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/logs");
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>)["x-workbench-write"]).toBe("1");
  });

  it("会话详情与 git 分支在 Web 模式走 REST 而不是 invoke", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "s/1", messages: [] }),
    }));
    await api.opencodeSessionDetail(4096, "s/1");
    expect(decodeURIComponent(String(fetchMock.mock.calls.at(-1)?.[0]))).toBe(
      "/api/sessions/opencode/s/1?port=4096"
    );
    await api.gitBranch("C:\\proj");
    expect(decodeURIComponent(String(fetchMock.mock.calls.at(-1)?.[0]))).toBe(
      "/api/git/branch?dir=C:\\proj"
    );
    expect(invokeMock).not.toHaveBeenCalled();
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

  it("助手流式：解析 SSE 增量、跳过坏帧并处理末尾缓冲", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'data: {"kind":"delta","text":"你"}\n\nevent: ping\n\n',
      'data: {"kind":"step","text":"","step":{"tool":"calculate"}}\n\ndata: {bad}\n\n',
      // 故意不带结尾换行：验证 decoder 收尾时 buffer 仍会被消费。
      'data: {"kind":"done","text":"好"}',
    ];
    let cursor = 0;
    const reader = {
      read: async () =>
        cursor < chunks.length
          ? { done: false, value: encoder.encode(chunks[cursor++]) }
          : { done: true, value: undefined },
    };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      body: { getReader: () => reader },
    });
    const events: unknown[] = [];
    const config = {
      base_url: "http://127.0.0.1:18082/v1",
      model: "minicpm5-2b",
      temperature: 0.2,
      max_tokens: 1024,
      thinking: false,
      server_bin: "",
      model_path: "",
      context_size: 8192,
    };
    await api.assistantChatStream(
      [{ role: "user", content: "算一下" }],
      config,
      "req-http",
      (event) => events.push(event)
    );
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/assistant/chat/stream");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.accept).toBe("text/event-stream");
    expect(headers["x-workbench-write"]).toBe("1");
    expect(JSON.parse(String(init.body))).toMatchObject({
      request_id: "req-http",
      messages: [{ role: "user", content: "算一下" }],
    });
    expect(events).toEqual([
      { kind: "delta", text: "你" },
      { kind: "step", text: "", step: { tool: "calculate" } },
      { kind: "done", text: "好" },
    ]);
  });

  it("助手流式：HTTP 错误与无 body 明确抛出，取消走 POST", async () => {
    const config = {
      base_url: "http://127.0.0.1:18082/v1",
      model: "minicpm5-2b",
      temperature: 0.2,
      max_tokens: 1024,
      thinking: false,
      server_bin: "",
      model_path: "",
      context_size: 8192,
    };
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      text: async () => "upstream down",
    });
    await expect(api.assistantChatStream([], config, "r1", () => {})).rejects.toThrow(
      "HTTP 502: upstream down"
    );
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: async () => "",
    });
    await expect(api.assistantChatStream([], config, "r1b", () => {})).rejects.toThrow(
      "HTTP 503: Service Unavailable"
    );
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, body: null });
    await expect(api.assistantChatStream([], config, "r2", () => {})).rejects.toThrow(
      /不支持流式响应/
    );
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    await api.assistantCancel("r3");
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/assistant/cancel");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ request_id: "r3" });
    expect((init.headers as Record<string, string>)["x-workbench-write"]).toBe("1");
  });

  it("助手服务启停在 Web 模式明确拒绝，不发请求", async () => {
    const before = fetchMock.mock.calls.length;
    const config = {
      base_url: "http://127.0.0.1:18082/v1",
      model: "minicpm5-2b",
      temperature: 0.2,
      max_tokens: 1024,
      thinking: false,
      server_bin: "",
      model_path: "",
      context_size: 8192,
    };
    await expect(api.assistantStartService(config)).rejects.toThrow(
      "ASSISTANT_DESKTOP_ONLY"
    );
    await expect(api.assistantStopService()).rejects.toThrow("ASSISTANT_DESKTOP_ONLY");
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("助手普通对话在 Web 模式走 POST /api/assistant/chat", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ content: "好", steps: [], usage: null }),
    });
    const config = {
      base_url: "http://127.0.0.1:18082/v1",
      model: "minicpm5-2b",
      temperature: 0.2,
      max_tokens: 1024,
      thinking: false,
      server_bin: "",
      model_path: "",
      context_size: 8192,
    };
    const reply = await api.assistantChat([{ role: "user", content: "hi" }], config);
    expect(reply.content).toBe("好");
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/assistant/chat");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({
      messages: [{ role: "user", content: "hi" }],
    });
    expect((init.headers as Record<string, string>)["x-workbench-write"]).toBe("1");
  });
});

describe("助手在纯静态 demo 模式", () => {
  beforeEach(async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    (await import("./transport")).__resetTransportForTests();
  });

  afterEach(() => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  it("所有助手入口都明确拒绝，流式与取消不偷偷发请求", async () => {
    const config = {
      base_url: "http://127.0.0.1:18082/v1",
      model: "minicpm5-2b",
      temperature: 0.2,
      max_tokens: 1024,
      thinking: false,
      server_bin: "",
      model_path: "",
      context_size: 8192,
    };
    await expect(api.assistantConfig()).rejects.toThrow("ASSISTANT_DESKTOP_ONLY");
    await expect(api.assistantSaveConfig(config)).rejects.toThrow(
      "ASSISTANT_DESKTOP_ONLY"
    );
    await expect(api.assistantStatus(config)).rejects.toThrow("ASSISTANT_DESKTOP_ONLY");
    await expect(api.assistantChat([], config)).rejects.toThrow("ASSISTANT_DESKTOP_ONLY");
    await expect(api.assistantChatStream([], config, "demo", () => {})).rejects.toThrow(
      "ASSISTANT_DESKTOP_ONLY"
    );
    // cancel 在 demo 下是静默 no-op，不抛错也不发请求。
    await expect(api.assistantCancel("demo")).resolves.toBeUndefined();
  });
});
