import { invoke } from "@tauri-apps/api/core";
import { classifyOpenTarget } from "./openTarget";
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

/** 是否运行在 Tauri 桌面壳内 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function listProcesses(): Promise<ProcInfo[]> {
  return invoke<ProcInfo[]>("list_processes");
}

export async function terminateProcess(pid: number): Promise<void> {
  return invoke("terminate_process", { pid });
}

/** 以管理员结束进程：Windows 触发 UAC 授权，受保护进程由后端直接拒绝。 */
export async function terminateProcessElevated(pid: number): Promise<void> {
  return invoke("terminate_process_elevated", { pid });
}

export async function listPorts(): Promise<PortEntry[]> {
  return invoke<PortEntry[]>("list_ports");
}

export async function listDevServers(): Promise<DevServer[]> {
  return invoke<DevServer[]>("list_dev_servers");
}

export async function listAiProcesses(): Promise<AiProcess[]> {
  return invoke<AiProcess[]>("list_ai_processes");
}

export async function opencodeSessions(): Promise<OpencodeSessionsResult> {
  return invoke<OpencodeSessionsResult>("opencode_sessions");
}

export async function recentSessions(): Promise<SessionFilePreview[]> {
  return invoke<SessionFilePreview[]>("recent_sessions_preview");
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

export async function systemInfo(): Promise<SystemInfo> {
  return invoke<SystemInfo>("system_info");
}

export async function diskInfo(): Promise<DiskInfo[]> {
  return invoke<DiskInfo[]>("disk_info");
}

export async function loadData(): Promise<WorkbenchData> {
  return invoke<WorkbenchData>("load_data");
}

export async function loadDataVersioned(): Promise<{
  data: WorkbenchData;
  generation: string;
}> {
  return invoke("load_data_versioned");
}

export async function saveData(data: WorkbenchData, generation: string): Promise<string> {
  return invoke("save_data", { data, generation });
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
      if (!isTauri()) return;
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
  return invoke<string>("read_logs", { maxLines });
}

export async function clearLogs(): Promise<void> {
  await invoke("clear_logs");
}

// ── 成本计量 ──────────────────────────────────────────────

/** 扫描 session 文件 → 提取 usage → 计算成本 → 持久化 */
export async function scanSessionCosts(): Promise<ScanCostResult> {
  return invoke<ScanCostResult>("scan_session_costs");
}

/** 获取成本总览（不重新扫描） */
export async function getCostOverview(): Promise<CostOverview> {
  return invoke<CostOverview>("get_cost_overview");
}

/** 获取成本趋势 */
export async function getCostTrend(days: number = 14): Promise<CostTrendRow[]> {
  return invoke<CostTrendRow[]>("get_cost_trend", { days });
}

/** 按模型分解成本 */
export async function getModelBreakdown(): Promise<ModelBreakdownRow[]> {
  return invoke<ModelBreakdownRow[]>("get_model_breakdown");
}

/** 按项目目录归因成本（"哪个仓库花钱最多"） */
export async function getProjectBreakdown(): Promise<ProjectBreakdownRow[]> {
  return invoke<ProjectBreakdownRow[]>("get_project_breakdown");
}

/** 扩展趋势：最近 `days` 天按日，更早的按月聚合 */
export async function getCostTrendExtended(days: number): Promise<ExtendedTrend> {
  return invoke<ExtendedTrend>("get_cost_trend_extended", { days });
}

/** 台账导出：原始成本记录（含估算行，来源列自述）。上限 20 万行。 */
export async function getCostExportRows(limit = 200_000): Promise<CostExportRow[]> {
  return invoke<CostExportRow[]>("get_cost_export", { limit });
}

/** 获取成本设置 */
export async function getCostSettings(): Promise<CostSettings> {
  return invoke<CostSettings>("get_cost_settings_cmd");
}

/** 保存成本设置 */
export async function saveCostSettings(settings: CostSettings): Promise<void> {
  return invoke("save_cost_settings_cmd", { settings });
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
  return invoke<PricingView>("get_pricing");
}

export async function savePricing(
  overrides: Record<string, [number, number]>
): Promise<PricingView> {
  return invoke<PricingView>("save_pricing", { overrides });
}

export async function clearCostRecords(): Promise<void> {
  return invoke("clear_cost_records");
}

// ── 环境自检 ──────────────────────────────────────────────

/** 运行环境逐项检查（平台、数据目录、会话目录、端口工具…）。 */
export async function runDiagnostics(): Promise<DiagnosticsReport> {
  return invoke<DiagnosticsReport>("diagnostics");
}
