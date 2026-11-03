//! IPC 契约导出：把所有跨 IPC 的 Rust 类型导出为 TypeScript 定义。
//!
//! 单一事实来源：前端 `src/types.ts` 改为从 `src/generated/` re-export，
//! Rust 结构体一改，跑 `cargo test --test export_bindings` 即重新生成，
//! 前端 tsc 立刻暴露契约漂移 —— 不再依赖人肉双维护。

use std::path::Path;
use ts_rs::{Config, TS};
use workbench_lib::ai::{
    AiProcess, OpencodeSession, SessionDetail, SessionFile, SessionFilePreview,
};
use workbench_lib::commands::{
    BackupPoint, BackupResult, DiskInfo, OpencodeSessionsResult, PricingView, RestoreResult,
    ScanCostResult, SystemInfo,
};
use workbench_lib::cost_store::{
    CostExportRow, CostMonthRow, CostOverview, CostSettings, CostTrendRow, ExtendedTrend,
    ModelBreakdownRow, ProjectBreakdownRow,
};
use workbench_lib::data::{Project, Task, WorkbenchData};
use workbench_lib::devserver::DevServer;
use workbench_lib::diagnostics::{DiagnosticCheck, DiagnosticsReport};
use workbench_lib::ports::PortEntry;
use workbench_lib::pricing::PricingRow;
use workbench_lib::procs::ProcInfo;

#[test]
fn export_ts_bindings() {
    let out_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/generated");
    std::fs::create_dir_all(&out_dir).expect("创建 generated 目录失败");
    let cfg = Config::new().with_out_dir(&out_dir);

    ProcInfo::export_all(&cfg).unwrap();
    PortEntry::export_all(&cfg).unwrap();
    DevServer::export_all(&cfg).unwrap();
    AiProcess::export_all(&cfg).unwrap();
    OpencodeSession::export_all(&cfg).unwrap();
    OpencodeSessionsResult::export_all(&cfg).unwrap();
    SessionDetail::export_all(&cfg).unwrap();
    SessionFile::export_all(&cfg).unwrap();
    SessionFilePreview::export_all(&cfg).unwrap();
    CostSettings::export_all(&cfg).unwrap();
    CostOverview::export_all(&cfg).unwrap();
    CostTrendRow::export_all(&cfg).unwrap();
    ModelBreakdownRow::export_all(&cfg).unwrap();
    ProjectBreakdownRow::export_all(&cfg).unwrap();
    CostMonthRow::export_all(&cfg).unwrap();
    ExtendedTrend::export_all(&cfg).unwrap();
    CostExportRow::export_all(&cfg).unwrap();
    Project::export_all(&cfg).unwrap();
    Task::export_all(&cfg).unwrap();
    WorkbenchData::export_all(&cfg).unwrap();
    SystemInfo::export_all(&cfg).unwrap();
    DiskInfo::export_all(&cfg).unwrap();
    ScanCostResult::export_all(&cfg).unwrap();
    PricingRow::export_all(&cfg).unwrap();
    PricingView::export_all(&cfg).unwrap();
    BackupResult::export_all(&cfg).unwrap();
    BackupPoint::export_all(&cfg).unwrap();
    RestoreResult::export_all(&cfg).unwrap();
    DiagnosticCheck::export_all(&cfg).unwrap();
    DiagnosticsReport::export_all(&cfg).unwrap();
}
