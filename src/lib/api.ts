import { invoke } from "@tauri-apps/api/core";
import { classifyOpenTarget } from "./openTarget";
import { currentTransport, httpJson } from "./transport";
import { t } from "./i18n";
import type {
  AiProcess,
  DiagnosticsReport,
  CostOverview,
  CostSettings,
  CostTrendRow,
  CostExportRow,
  ExtendedTrend,
  ProjectBreakdownRow,
  DevServer,
  DiskInfo,
  ModelBreakdownRow,
  OpencodeSessionsResult,
  PortEntry,
  BackupPoint,
  BackupResult,
  PricingView,
  RestoreResult,
  ProcInfo,
  ScanCostResult,
  SessionDetail,
  SessionFilePreview,
  SystemInfo,
  WorkbenchData,
} from "../types";

/** 是否运行在 Tauri 桌面壳内（有 IPC、托盘、置顶等原生能力）。 */
export function isTauri(): boolean {
  // 同步判定：不依赖异步探测，否则首帧会误判成浏览器。
  // 这个信号由 Tauri 注入，测试里也用它来切换环境。
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * 是否有真实后端（桌面 IPC 或 `workbench serve` 的 HTTP API）。
 *
 * 与 `isTauri()` 的区别：浏览器连着 HTTP 后端时，进程/端口/成本都是真的，
 * 只是没有托盘这类桌面专属能力。页面判断「能不能显示真实数据」用这个，
 * 判断「要不要显示托盘设置项」才用 `isTauri()`。
 */
export function isBackend(): boolean {
  // 桌面端恒有后端；浏览器端要等探测确认连上了 HTTP 服务。
  return isTauri() || currentTransport() === "http";
}

export async function listProcesses(): Promise<ProcInfo[]> {
  if (isTauri()) return invoke<ProcInfo[]>("list_processes");
  return httpJson<ProcInfo[]>("/api/processes");
}

/**
 * 结束进程。**只有桌面端提供**：浏览器里没有可信的「用户确认」环节，
 * 把不可逆操作暴露成 HTTP 端点等于给任何网页一次免确认的杀进程能力。
 */
export async function terminateProcess(pid: number): Promise<void> {
  if (!isTauri()) {
    throw new Error("结束进程仅在桌面应用中可用（Web 模式不提供该操作）");
  }
  return invoke("terminate_process", { pid });
}

/** 以管理员结束进程：Windows 触发 UAC 授权，受保护进程由后端直接拒绝。 */
export async function terminateProcessElevated(pid: number): Promise<void> {
  if (!isTauri()) {
    throw new Error("提权结束进程仅在桌面应用中可用");
  }
  return invoke("terminate_process_elevated", { pid });
}

export async function listPorts(): Promise<PortEntry[]> {
  if (isTauri()) return invoke<PortEntry[]>("list_ports");
  return httpJson<PortEntry[]>("/api/ports");
}

export async function listDevServers(): Promise<DevServer[]> {
  if (isTauri()) return invoke<DevServer[]>("list_dev_servers");
  return httpJson<DevServer[]>("/api/dev-servers");
}

export async function listAiProcesses(): Promise<AiProcess[]> {
  if (isTauri()) return invoke<AiProcess[]>("list_ai_processes");
  return httpJson<AiProcess[]>("/api/ai-processes");
}

export async function opencodeSessions(): Promise<OpencodeSessionsResult> {
  if (isTauri()) return invoke<OpencodeSessionsResult>("opencode_sessions");
  const probe = await httpJson<{
    port: number;
    available: boolean;
    sessions: OpencodeSessionsResult["sessions"];
    error: string | null;
  }>("/api/sessions/opencode");
  // HTTP 端把「没装 opencode」表达成 available:false，而 IPC 会直接抛错。
  // 统一成「抛错」语义，调用方不必写两套分支。
  if (!probe.available) {
    throw new Error(probe.error ?? "未检测到运行中的 opencode 服务");
  }
  return { port: probe.port, sessions: probe.sessions };
}

export async function recentSessions(): Promise<SessionFilePreview[]> {
  if (isTauri()) return invoke<SessionFilePreview[]>("recent_sessions_preview");
  return httpJson<SessionFilePreview[]>("/api/sessions");
}

export async function opencodeSessionDetail(
  port: number,
  sessionId: string
): Promise<SessionDetail> {
  return invoke<SessionDetail>("opencode_session_detail", { port, sessionId });
}

export async function gitBranch(dir: string): Promise<string> {
  return invoke<string>("git_branch", { dir });
}

/** 切换主窗口置顶。 */
export async function setAlwaysOnTop(on: boolean): Promise<void> {
  return invoke("set_always_on_top", { on });
}

/** 打开/聚焦工作小窗（桌面端由后端创建独立窗口）。 */
export async function openMiniWindow(): Promise<void> {
  return invoke("open_mini_window");
}

/** 从工作小窗唤回主窗口。 */
export async function showMainWindow(): Promise<void> {
  return invoke("show_main_window");
}

/** 关闭当前窗口（工作小窗用）。 */
export async function closeCurrentWindow(): Promise<void> {
  return invoke("close_current_window");
}

export async function systemInfo(): Promise<SystemInfo> {
  if (isTauri()) return invoke<SystemInfo>("system_info");
  return httpJson<SystemInfo>("/api/system");
}

export async function diskInfo(): Promise<DiskInfo[]> {
  if (isTauri()) return invoke<DiskInfo[]>("disk_info");
  return httpJson<DiskInfo[]>("/api/disks");
}

export async function loadData(): Promise<WorkbenchData> {
  return invoke<WorkbenchData>("load_data");
}

export async function loadDataVersioned(): Promise<{
  data: WorkbenchData;
  generation: string;
}> {
  if (isTauri()) return invoke("load_data_versioned");
  // HTTP 端用数据文件指纹做乐观锁令牌，与桌面端 generation 语义一致：
  // 别的窗口动过数据，令牌就变，保存会被后端 409 拒绝。
  return httpJson<{ data: WorkbenchData; generation: string }>("/api/data");
}

export async function saveData(data: WorkbenchData, generation: string): Promise<string> {
  if (isTauri()) return invoke("save_data", { data, generation });
  const res = await httpJson<{ ok: boolean; generation: string }>("/api/data", {
    method: "PUT",
    body: data,
    // If-Match 提供并发保护；写入标记头用于挡住跨源请求（会触发 CORS 预检）。
    headers: { "if-match": generation, "x-workbench-write": "1" },
  });
  return res.generation ?? generation;
}

/** 用系统默认方式打开 URL / 目录。
 * URL 走 opener 插件；目录必须经后端 `open_known_path` 白名单校验，
 * 因此 capabilities 里不再给 WebView 直接的 allow-open-path 权限。
 * 目标分类（含 Windows 盘符 vs URL scheme 的区分）在 lib/openTarget。 */
export async function openExternal(target: string): Promise<void> {
  const classified = classifyOpenTarget(target);
  switch (classified.kind) {
    case "empty":
      return;
    case "http": {
      if (!isTauri()) {
        window.open(classified.value, "_blank", "noopener");
        return;
      }
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(classified.value);
      return;
    }
    case "unsupported":
      // 不静默：调用方要能看到原因，而不是点击后毫无反应
      throw new Error(`不支持的链接协议: ${classified.scheme}`);
    case "path": {
      if (!isTauri()) throw new Error(t("app.pathDesktopOnly"));
      await invoke("open_known_path", { path: classified.value });
    }
  }
}

// ── 系统通知 ──────────────────────────────────────────────

/**
 * 请求通知权限（桌面端在首次告警前调用一次）。
 * Tauri 的 notification 插件在未授权时 sendNotification 会静默失败，
 * 预算告警就成了「界面有横幅、系统没通知」的假象。
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if (isTauri()) {
      const { isPermissionGranted, requestPermission } =
        await import("@tauri-apps/plugin-notification");
      if (await isPermissionGranted()) return true;
      return (await requestPermission()) === "granted";
    }
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/** 发送系统通知（桌面端原生通知，浏览器端尝试 Notification API）。 */
export async function notify(title: string, body: string): Promise<void> {
  if (isTauri()) {
    const { sendNotification } = await import("@tauri-apps/plugin-notification");
    sendNotification({ title, body });
  } else if (
    typeof Notification !== "undefined" &&
    Notification.permission === "granted"
  ) {
    new Notification(title, { body });
  }
}

// ── 日志读取 ──────────────────────────────────────────────

export async function readLogs(maxLines: number): Promise<string> {
  if (!isTauri()) {
    // 服务端日志文件不在 HTTP 暴露面内（可能含本机路径），Web 模式明确不支持。
    throw new Error("运行日志仅在桌面应用中可读");
  }
  return invoke<string>("read_logs", { maxLines });
}

export async function clearLogs(): Promise<void> {
  if (!isTauri()) throw new Error("运行日志仅在桌面应用中可管理");
  await invoke("clear_logs");
}

// ── 成本计量 ──────────────────────────────────────────────

/** 扫描 session 文件 → 提取 usage → 计算成本 → 持久化 */
export async function scanSessionCosts(): Promise<ScanCostResult> {
  if (isTauri()) return invoke<ScanCostResult>("scan_session_costs");
  return httpJson<ScanCostResult>("/api/cost/scan", {
    method: "POST",
    write: true,
  });
}

/** 获取成本总览（不重新扫描） */
export async function getCostOverview(): Promise<CostOverview> {
  if (isTauri()) return invoke<CostOverview>("get_cost_overview");
  return httpJson<CostOverview>("/api/cost/overview");
}

/** 获取成本趋势 */
export async function getCostTrend(days: number = 14): Promise<CostTrendRow[]> {
  if (isTauri()) return invoke<CostTrendRow[]>("get_cost_trend", { days });
  return httpJson<CostTrendRow[]>("/api/cost/trend?days=" + days);
}

/** 按模型分解成本 */
export async function getModelBreakdown(): Promise<ModelBreakdownRow[]> {
  if (isTauri()) return invoke<ModelBreakdownRow[]>("get_model_breakdown");
  return httpJson<ModelBreakdownRow[]>("/api/cost/models");
}

/** 按项目目录归因成本（"哪个仓库花钱最多"） */
export async function getProjectBreakdown(): Promise<ProjectBreakdownRow[]> {
  if (isTauri()) return invoke<ProjectBreakdownRow[]>("get_project_breakdown");
  return httpJson<ProjectBreakdownRow[]>("/api/cost/projects");
}

/** 扩展趋势：最近 `days` 天按日，更早的按月聚合 */
export async function getCostTrendExtended(days: number): Promise<ExtendedTrend> {
  if (isTauri()) return invoke<ExtendedTrend>("get_cost_trend_extended", { days });
  return httpJson<ExtendedTrend>("/api/cost/trend-extended?days=" + days);
}

/** 台账导出：原始成本记录（含估算行，来源列自述）。上限 20 万行。 */
export async function getCostExportRows(limit = 200_000): Promise<CostExportRow[]> {
  if (isTauri()) return invoke<CostExportRow[]>("get_cost_export", { limit });
  return httpJson<CostExportRow[]>("/api/cost/export?limit=" + limit);
}

/** 获取成本设置 */
export async function getCostSettings(): Promise<CostSettings> {
  if (isTauri()) return invoke<CostSettings>("get_cost_settings_cmd");
  return httpJson<CostSettings>("/api/cost/settings");
}

/** 保存成本设置 */
export async function saveCostSettings(settings: CostSettings): Promise<void> {
  if (isTauri()) return invoke("save_cost_settings_cmd", { settings });
  await httpJson<{ ok: boolean }>("/api/cost/settings", {
    method: "PUT",
    body: settings,
    write: true,
  });
}

/** 清空全部成本记录 */
export async function backupData(): Promise<BackupResult> {
  return invoke<BackupResult>("backup_data");
}

export async function openBackupDir(): Promise<string> {
  return invoke<string>("open_backup_dir");
}

export async function listBackups(): Promise<BackupPoint[]> {
  return invoke<BackupPoint[]>("list_backups");
}

export async function restoreBackup(id: string): Promise<RestoreResult> {
  return invoke<RestoreResult>("restore_backup", { id });
}

export async function getPricing(): Promise<PricingView> {
  if (isTauri()) return invoke<PricingView>("get_pricing");
  return httpJson<PricingView>("/api/cost/pricing");
}

export async function savePricing(
  overrides: Record<string, [number, number]>
): Promise<PricingView> {
  if (isTauri()) return invoke<PricingView>("save_pricing", { overrides });
  return httpJson<PricingView>("/api/cost/pricing", {
    method: "PUT",
    body: overrides,
    write: true,
  });
}

export async function clearCostRecords(): Promise<void> {
  if (!isTauri()) {
    throw new Error("清空成本记录仅在桌面应用中可用");
  }
  return invoke("clear_cost_records");
}

// ── 环境自检 ──────────────────────────────────────────────

/** 运行环境逐项检查（平台、数据目录、会话目录、端口工具…）。 */
export async function runDiagnostics(): Promise<DiagnosticsReport> {
  if (isTauri()) return invoke<DiagnosticsReport>("diagnostics");
  return httpJson<DiagnosticsReport>("/api/diagnostics");
}

/** 真实数据文件路径（设置页展示用）。后端解析，跨平台正确。 */
export async function dataFilePath(): Promise<string | null> {
  try {
    if (isTauri()) return await invoke<string>("data_path");
    return await httpJson<string>("/api/data/path");
  } catch {
    return null;
  }
}
