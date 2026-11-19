import { vi } from "vitest";
import { setLang } from "./i18n";

/**
 * store 行为测试的共享脚手架。
 *
 * 原先三组动作测试挤在同一个 836 行文件里，各自复制 IPC mock / 状态重置；
 * 现在拆成独立文件，只保留这一份 api mock 与 reset，避免测试之间互相污染。
 */
export const api = {
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
  getCostTrendExtended: vi.fn(),
  getModelBreakdown: vi.fn(),
  getProjectBreakdown: vi.fn(),
  getCostExportRows: vi.fn(),
  getCostSettings: vi.fn(),
  saveCostSettings: vi.fn(),
  scanSessionCosts: vi.fn(),
  clearCostRecords: vi.fn(),
  notify: vi.fn(),
  ensureNotificationPermission: vi.fn(),
};

export const harness = { tauriMode: true };

export function proc(over: Record<string, unknown> = {}) {
  return {
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
  };
}

export function resetApi(): void {
  Object.values(api).forEach((fn) => fn.mockReset());
  // 0.5.0 新接口的兜底 mock：成功且为空；个别用例按需覆盖
  api.getCostTrendExtended.mockResolvedValue({ days: 14, daily: [], monthly: [] });
  api.getProjectBreakdown.mockResolvedValue([]);
  api.getCostExportRows.mockResolvedValue([]);
  api.opencodeSessions.mockResolvedValue({ port: 4096, sessions: [] });
  api.recentSessions.mockResolvedValue([]);
  harness.tauriMode = true;
}

export function resetStore(store: {
  setState: (partial: Record<string, unknown>) => void;
}): void {
  store.setState({
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
}

setLang("zh");
