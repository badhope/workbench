// ─────────────────────────────────────────────────────────────
// IPC 契约类型 —— 单一事实来源是 Rust 结构体（src-tauri/src/*.rs）。
//
// 本文件只做 re-export：具体定义由 `cargo test --test export_bindings`
// 生成到 src/generated/，Rust 侧一改，前端 tsc 立刻暴露漂移，
// 不再人肉双维护。不要在这里手写跨 IPC 的类型。
//
// 仅前端使用的视图类型（ViewKey 等）仍定义在本文件底部。
// ─────────────────────────────────────────────────────────────

export type { AiProcess } from "./generated/AiProcess";
export type { OpencodeSession } from "./generated/OpencodeSession";
export type { OpencodeSessionsResult } from "./generated/OpencodeSessionsResult";
export type { SessionDetail } from "./generated/SessionDetail";
export type { SessionFile } from "./generated/SessionFile";
export type { SessionFilePreview } from "./generated/SessionFilePreview";

export type { ProcInfo } from "./generated/ProcInfo";
export type { PortEntry } from "./generated/PortEntry";
export type { DevServer } from "./generated/DevServer";

export type { Project } from "./generated/Project";
export type { Task } from "./generated/Task";
export type { WorkbenchData } from "./generated/WorkbenchData";

export type { SystemInfo } from "./generated/SystemInfo";
export type { DiskInfo } from "./generated/DiskInfo";
export type { ScanCostResult } from "./generated/ScanCostResult";
export type { PricingRow } from "./generated/PricingRow";
export type { PricingView } from "./generated/PricingView";
export type { BackupResult } from "./generated/BackupResult";
export type { BackupPoint } from "./generated/BackupPoint";
export type { RestoreResult } from "./generated/RestoreResult";
export type { DiagnosticCheck } from "./generated/DiagnosticCheck";
export type { DiagnosticsReport } from "./generated/DiagnosticsReport";

export type { CostSettings } from "./generated/CostSettings";
export type { CostOverview } from "./generated/CostOverview";
export type { CostTrendRow } from "./generated/CostTrendRow";
export type { ModelBreakdownRow } from "./generated/ModelBreakdownRow";
export type { ProjectBreakdownRow } from "./generated/ProjectBreakdownRow";
export type { CostMonthRow } from "./generated/CostMonthRow";
export type { ExtendedTrend } from "./generated/ExtendedTrend";
export type { CostExportRow } from "./generated/CostExportRow";

// ── 仅前端使用的类型 ──────────────────────────────────────────

/** 侧边栏视图 key：由页面注册表派生，新增页面只需改 pages/registry。 */
export type { ViewKey } from "./pages/registry";
