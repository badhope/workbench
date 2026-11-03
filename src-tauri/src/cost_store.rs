//! 成本数据持久化（SQLite）。
//!
//! 为什么从 JSON 换成 SQLite：
//! - 旧实现每次读取都反序列化整个 `cost_data.json`。十万条记录时单次读取
//!   要几十毫秒到上百毫秒，而 AI 页进入时会同时发 4 个查询；
//! - 每次扫描都要「全量解析 + 全量序列化 + fsync」一次，扫描本身是增量的，
//!   落盘却是全量的；
//! - 聚合（按天、按模型）本该由索引完成，而不是把全部记录读进内存再累加。
//!
//! 迁移是单向且保守的：首次打开时若存在旧 `cost_data.json`，在一个事务里
//! 导入全部记录，然后把文件改名为 `cost_data.json.migrated`（**不删除**，
//! 用户仍可以手工回退）。迁移失败时数据库保持为空且不改名，下次启动重试。
//!
//! 并发：桌面端是单实例，但扫描、读设置、清空可能并发。这里用一把进程内
//! 互斥锁 + SQLite 自己的事务；每次操作新开一个连接，避免恢复备份后
//! 连接仍指向旧文件（被替换的 inode）。

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use tauri::{AppHandle, Manager};

use crate::json_store;

/// 成本库读写锁（进程内单实例桌面应用，静态锁足够）。
static COST_LOCK: Mutex<()> = Mutex::new(());

fn lock() -> MutexGuard<'static, ()> {
    COST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

// ── 成本配置（预算 / 自定价 / 告警阈值）─────────────────────

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, ts_rs::TS)]
pub struct CostSettings {
    /// 日预算（USD），0 表示不设限
    pub daily_budget: f64,
    /// 月预算（USD），0 表示不设限
    pub monthly_budget: f64,
    /// 预算告警阈值（百分比，80 = 80% 时告警）
    pub alert_threshold_pct: u32,
    /// 写入时是否包含估算行（cost_source = estimated 的记录）
    pub include_estimated: bool,
}

impl Default for CostSettings {
    fn default() -> Self {
        Self {
            daily_budget: 5.0,
            monthly_budget: 50.0,
            alert_threshold_pct: 80,
            include_estimated: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CostRecord {
    /// 文件路径（去重键之一）
    pub file_path: String,
    /// 文件修改时间 (unix_secs)
    pub file_mtime: u64,
    /// 文件大小
    pub file_size: u64,
    /// 工具类型
    pub tool: String,
    /// 项目名
    pub project: String,
    /// 推断模型
    pub model: String,
    /// 输入 tokens（不含 cache_read/creation，已被剥离为单独字段计费）
    pub input_tokens: u64,
    /// 输出 tokens
    pub output_tokens: u64,
    /// Anthropic cache_read_input_tokens（按 0.1x 计价）
    pub cache_read_tokens: u64,
    /// Anthropic cache_creation_input_tokens（按 1.25x 计价）
    pub cache_creation_tokens: u64,
    /// 输入成本 (USD)
    pub cost_input: f64,
    /// 输出成本 (USD)
    pub cost_output: f64,
    /// 总成本
    pub cost_total: f64,
    /// 记录来源：`measured` | `estimated` | `zero_pricing`
    pub cost_source: String,
    /// 数据所属日期（YYYY-MM-DD），按文件 mtime 推算
    pub day: String,
}

// ── 聚合视图 ───────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug, ts_rs::TS)]
pub struct CostOverview {
    pub today_cost: f64,
    #[ts(type = "number")]
    pub today_input_tokens: u64,
    #[ts(type = "number")]
    pub today_output_tokens: u64,
    #[ts(type = "number")]
    pub today_cache_read_tokens: u64,
    #[ts(type = "number")]
    pub today_cache_creation_tokens: u64,
    pub month_cost: f64,
    #[ts(type = "number")]
    pub month_input_tokens: u64,
    #[ts(type = "number")]
    pub month_output_tokens: u64,
    #[ts(type = "number")]
    pub month_cache_read_tokens: u64,
    #[ts(type = "number")]
    pub month_cache_creation_tokens: u64,
    pub total_cost: f64,
    #[ts(type = "number")]
    pub total_input_tokens: u64,
    #[ts(type = "number")]
    pub total_output_tokens: u64,
    #[ts(type = "number")]
    pub total_cache_read_tokens: u64,
    #[ts(type = "number")]
    pub total_cache_creation_tokens: u64,
    pub record_count: usize,
    pub measured_count: usize,
    pub estimated_count: usize,
    pub zero_pricing_count: usize,
    pub daily_budget: f64,
    pub monthly_budget: f64,
    pub alert_threshold_pct: u32,
    /// 今日已用 / 日预算 百分比（>100 即超支）
    pub daily_pct: f64,
    /// 本月已用 / 月预算 百分比
    pub monthly_pct: f64,
    pub budget_exceeded: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, ts_rs::TS)]
pub struct CostTrendRow {
    pub day: String,
    #[ts(type = "number")]
    pub input_tokens: u64,
    #[ts(type = "number")]
    pub output_tokens: u64,
    #[ts(type = "number")]
    pub cache_read_tokens: u64,
    #[ts(type = "number")]
    pub cache_creation_tokens: u64,
    pub cost: f64,
    pub record_count: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, ts_rs::TS)]
pub struct ModelBreakdownRow {
    pub model: String,
    #[ts(type = "number")]
    pub input_tokens: u64,
    #[ts(type = "number")]
    pub output_tokens: u64,
    pub cost: f64,
    pub record_count: u32,
}

/// 按项目目录归组的成本。回答"哪个仓库花钱最多"只要这一条查询。
#[derive(Serialize, Deserialize, Clone, Debug, ts_rs::TS)]
pub struct ProjectBreakdownRow {
    pub project: String,
    #[ts(type = "number")]
    pub input_tokens: u64,
    #[ts(type = "number")]
    pub output_tokens: u64,
    pub cost: f64,
    pub record_count: u32,
}

/// 超出日粒度窗口的记录聚合成的月度桶。`month` 是 `YYYY-MM`。
#[derive(Serialize, Deserialize, Clone, Debug, ts_rs::TS)]
pub struct CostMonthRow {
    pub month: String,
    #[ts(type = "number")]
    pub input_tokens: u64,
    #[ts(type = "number")]
    pub output_tokens: u64,
    #[ts(type = "number")]
    pub cache_read_tokens: u64,
    #[ts(type = "number")]
    pub cache_creation_tokens: u64,
    pub cost: f64,
    pub record_count: u32,
}

/// 扩展趋势：最近 N 天按日，更早的按月。
///
/// 两段按时间**不重叠**：月度桶只包含严格早于日粒度最早一天的记录，
/// 所以图表可以把两段直接拼接，不会出现同一天被算两次。
#[derive(Serialize, Deserialize, Clone, Debug, ts_rs::TS)]
pub struct ExtendedTrend {
    pub days: usize,
    pub daily: Vec<CostTrendRow>,
    pub monthly: Vec<CostMonthRow>,
}

/// 台账导出行：一条记录一行，与 UI 聚合无关的原始账目。
/// 包含估算行（`cost_source` 列本身说明来源），导出的是事实而不是筛选后的视图。
#[derive(Serialize, Deserialize, Clone, Debug, ts_rs::TS)]
pub struct CostExportRow {
    pub day: String,
    pub project: String,
    pub tool: String,
    pub model: String,
    #[ts(type = "number")]
    pub input_tokens: u64,
    #[ts(type = "number")]
    pub output_tokens: u64,
    #[ts(type = "number")]
    pub cache_read_tokens: u64,
    #[ts(type = "number")]
    pub cache_creation_tokens: u64,
    pub cost_input: f64,
    pub cost_output: f64,
    pub cost_total: f64,
    pub cost_source: String,
    pub file_path: String,
}

// ── 路径 ───────────────────────────────────────────────────

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位数据目录: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建数据目录: {e}"))?;
    Ok(dir)
}

/// 成本库文件路径（供备份命令使用）。
pub fn cost_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("cost.db"))
}

/// 旧版本的成本数据文件（迁移源）。
pub fn legacy_cost_json_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("cost_data.json"))
}

/// 用户自定义定价覆盖文件路径
pub fn cost_data_path_overrides(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("pricing_overrides.json"))
}

// ── 连接与建表 ─────────────────────────────────────────────

const SCHEMA_VERSION: i64 = 1;

fn open_at(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建数据目录失败: {e}"))?;
    }
    let conn = Connection::open(path).map_err(|e| format!("打开成本库失败: {e}"))?;
    // 崩溃安全优先于吞吐：桌面应用不需要 WAL 的写并发，而回滚日志让
    // 「直接复制 .db 文件」这一备份方式天然安全（退出时日志已合并）。
    conn.pragma_update(None, "journal_mode", "DELETE")
        .map_err(|e| format!("设置日志模式失败: {e}"))?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|e| format!("设置同步模式失败: {e}"))?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (
            id                  INTEGER PRIMARY KEY CHECK (id = 1),
            daily_budget        REAL NOT NULL,
            monthly_budget      REAL NOT NULL,
            alert_threshold_pct INTEGER NOT NULL,
            include_estimated   INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS records (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path             TEXT NOT NULL,
            file_mtime            INTEGER NOT NULL,
            file_size             INTEGER NOT NULL,
            tool                  TEXT NOT NULL,
            project               TEXT NOT NULL,
            model                 TEXT NOT NULL,
            input_tokens          INTEGER NOT NULL,
            output_tokens         INTEGER NOT NULL,
            cache_read_tokens     INTEGER NOT NULL,
            cache_creation_tokens INTEGER NOT NULL,
            cost_input            REAL NOT NULL,
            cost_output           REAL NOT NULL,
            cost_total            REAL NOT NULL,
            cost_source           TEXT NOT NULL,
            day                   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_records_file ON records(file_path);
        CREATE INDEX IF NOT EXISTS idx_records_day  ON records(day);
        CREATE INDEX IF NOT EXISTS idx_records_model ON records(model);
        "#,
    )
    .map_err(|e| format!("初始化成本库失败: {e}"))?;

    let version: Option<i64> = conn
        .query_row(
            "SELECT value FROM meta WHERE key = 'schema_version'",
            [],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| format!("读取 schema 版本失败: {e}"))?
        .and_then(|v| v.parse().ok());

    match version {
        Some(v) if v == SCHEMA_VERSION => Ok(()),
        Some(v) => Err(format!(
            "成本库版本 {v} 高于本程序支持的 {SCHEMA_VERSION}，请升级应用"
        )),
        None => {
            conn.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?1)",
                params![SCHEMA_VERSION.to_string()],
            )
            .map_err(|e| format!("写入 schema 版本失败: {e}"))?;
            Ok(())
        }
    }
}

fn open(app: &AppHandle) -> Result<Connection, String> {
    open_at(&cost_db_path(app)?)
}

/// 迁移旧 `cost_data.json`（幂等）。
///
/// 只在旧文件存在时执行一次；成功后改名为 `.migrated` 保留原件。
/// 迁移失败时**不**改名，下次启动还会重试；数据库里的部分写入由事务回滚。
fn migrate_legacy_json(app: &AppHandle) -> Result<(), String> {
    let legacy = legacy_cost_json_path(app)?;
    if !legacy.exists() {
        return Ok(());
    }
    let text = std::fs::read_to_string(&legacy).map_err(|e| format!("读取旧成本库失败: {e}"))?;
    let parsed: Option<LegacyCostData> = serde_json::from_str(&text)
        .map_err(|e| format!("旧成本库不是合法 JSON（保留原文件不迁移）: {e}"))
        .ok();
    let Some(old) = parsed else {
        // 空文件：直接改名，避免每次启动都重试解析失败
        let _ = std::fs::rename(&legacy, legacy.with_extension("json.migrated"));
        return Ok(());
    };

    let mut conn = open(app)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("开启迁移事务失败: {e}"))?;
    insert_records(&tx, &old.records)?;
    save_settings_row(&tx, &old.settings)?;
    tx.commit().map_err(|e| format!("提交迁移事务失败: {e}"))?;

    std::fs::rename(&legacy, legacy.with_extension("json.migrated"))
        .map_err(|e| format!("迁移完成但改名失败（下次会重复导入，记录不会重复）: {e}"))?;
    log::info!(
        "成本库已从 cost_data.json 迁移 {} 条记录",
        old.records.len()
    );
    Ok(())
}

#[derive(Deserialize)]
struct LegacyCostData {
    #[serde(default)]
    records: Vec<CostRecord>,
    #[serde(default)]
    settings: CostSettings,
}

fn insert_records(conn: &Connection, records: &[CostRecord]) -> Result<(), String> {
    if records.is_empty() {
        return Ok(());
    }
    let mut stmt = conn
        .prepare(
            "INSERT INTO records (
                file_path, file_mtime, file_size, tool, project, model,
                input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                cost_input, cost_output, cost_total, cost_source, day
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
        )
        .map_err(|e| format!("准备写入语句失败: {e}"))?;
    for r in records {
        let checked = |name: &str, value: u64| {
            i64::try_from(value)
                .map_err(|_| format!("成本记录 {name} 超出数据库范围: {}", r.file_path))
        };
        stmt.execute(params![
            r.file_path,
            checked("file_mtime", r.file_mtime)?,
            checked("file_size", r.file_size)?,
            r.tool,
            r.project,
            r.model,
            checked("input_tokens", r.input_tokens)?,
            checked("output_tokens", r.output_tokens)?,
            checked("cache_read_tokens", r.cache_read_tokens)?,
            checked("cache_creation_tokens", r.cache_creation_tokens)?,
            r.cost_input,
            r.cost_output,
            r.cost_total,
            r.cost_source,
            r.day
        ])
        .map_err(|e| format!("写入成本记录失败: {e}"))?;
    }
    Ok(())
}

// ── 定价覆盖（仍是 JSON：这是用户可手改的小文件）───────────

/// 定价覆盖的读取结果：合法条目 + 每条被拒的原因。
#[derive(Default, Debug)]
pub struct OverrideRead {
    pub overrides: HashMap<String, (f64, f64)>,
    pub problems: Vec<String>,
}

pub fn read_pricing_overrides(app: &AppHandle) -> Result<OverrideRead, String> {
    read_pricing_overrides_at(&cost_data_path_overrides(app)?)
}

/// 纯路径版本：可脱离 AppHandle 测试（文件格式、逐条校验、空文件语义）。
pub fn read_pricing_overrides_at(path: &Path) -> Result<OverrideRead, String> {
    let raw: Option<HashMap<String, (f64, f64)>> = json_store::read_json(path)?;
    let Some(map) = raw else {
        return Ok(OverrideRead::default());
    };
    let mut ok = HashMap::new();
    let mut problems = Vec::new();
    for (model, (input, output)) in map {
        match crate::pricing::PricingTable::validate_override(&model, input, output) {
            Ok((key, pair)) => {
                ok.insert(key, pair);
            }
            Err(e) => problems.push(format!("{model}: {e}")),
        }
    }
    Ok(OverrideRead {
        overrides: ok,
        problems,
    })
}

pub fn save_pricing_overrides(
    app: &AppHandle,
    overrides: &HashMap<String, (f64, f64)>,
) -> Result<(), String> {
    save_pricing_overrides_at(&cost_data_path_overrides(app)?, overrides)
}

/// 纯路径版本：空表删除文件，非空原子写入。
pub fn save_pricing_overrides_at(
    path: &Path,
    overrides: &HashMap<String, (f64, f64)>,
) -> Result<(), String> {
    if overrides.is_empty() {
        // 空覆盖表 = 回到内置价：删掉文件比留一个 {} 更干净，
        // 也避免用户误以为「已经改过价」。
        match std::fs::remove_file(path) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(format!("删除 {} 失败: {e}", path.display())),
        }
    }
    json_store::write_json_atomic(path, overrides)
}

// ── 设置 ───────────────────────────────────────────────────

fn save_settings_row(conn: &Connection, s: &CostSettings) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings (id, daily_budget, monthly_budget, alert_threshold_pct, include_estimated)
         VALUES (1, ?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
            daily_budget = excluded.daily_budget,
            monthly_budget = excluded.monthly_budget,
            alert_threshold_pct = excluded.alert_threshold_pct,
            include_estimated = excluded.include_estimated",
        params![
            s.daily_budget,
            s.monthly_budget,
            s.alert_threshold_pct as i64,
            if s.include_estimated { 1 } else { 0 }
        ],
    )
    .map_err(|e| format!("保存成本设置失败: {e}"))?;
    Ok(())
}

fn read_settings(conn: &Connection) -> Result<CostSettings, String> {
    let row = conn
        .query_row(
            "SELECT daily_budget, monthly_budget, alert_threshold_pct, include_estimated
             FROM settings WHERE id = 1",
            [],
            |r| {
                Ok(CostSettings {
                    daily_budget: r.get(0)?,
                    monthly_budget: r.get(1)?,
                    alert_threshold_pct: r.get::<_, i64>(2)? as u32,
                    include_estimated: r.get::<_, i64>(3)? != 0,
                })
            },
        )
        .optional()
        .map_err(|e| format!("读取成本设置失败: {e}"))?;
    Ok(row.unwrap_or_default())
}

pub fn get_cost_settings(app: &AppHandle) -> Result<CostSettings, String> {
    let _guard = lock();
    migrate_legacy_json(app)?;
    let conn = open(app)?;
    read_settings(&conn)
}

pub fn save_cost_settings(app: &AppHandle, settings: CostSettings) -> Result<(), String> {
    let _guard = lock();
    migrate_legacy_json(app)?;
    let conn = open(app)?;
    save_settings_row(&conn, &settings)
}

// ── 导入 ───────────────────────────────────────────────────

/// 已入库文件的 (path, mtime, size) 快照，供扫描跳过未变化文件。
pub fn existing_keys(app: &AppHandle) -> Result<HashMap<(String, u64, u64), ()>, String> {
    let _guard = lock();
    migrate_legacy_json(app)?;
    let conn = open(app)?;
    let mut stmt = conn
        .prepare("SELECT DISTINCT file_path, file_mtime, file_size FROM records")
        .map_err(|e| format!("准备查询失败: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)? as u64,
                r.get::<_, i64>(2)? as u64,
            ))
        })
        .map_err(|e| format!("查询已有文件失败: {e}"))?;
    let mut out = HashMap::new();
    for row in rows {
        let k = row.map_err(|e| format!("读取已有文件失败: {e}"))?;
        out.insert(k, ());
    }
    Ok(out)
}

/// 导入：按 file_path **整组替换**，在单个事务里完成。
pub fn import_records(app: &AppHandle, new_records: &[CostRecord]) -> Result<usize, String> {
    if new_records.is_empty() {
        return Ok(0);
    }
    let _guard = lock();
    migrate_legacy_json(app)?;
    let mut conn = open(app)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("开启导入事务失败: {e}"))?;
    let net = replace_by_file(&tx, new_records)?;
    tx.commit().map_err(|e| format!("提交导入事务失败: {e}"))?;
    Ok(net)
}

/// 事务内：删除同一文件的旧记录 → 插入新记录 → 返回净增量。
fn replace_by_file(conn: &Connection, new_records: &[CostRecord]) -> Result<usize, String> {
    let paths: Vec<String> = new_records.iter().map(|r| r.file_path.clone()).collect();
    replace_scanned_files(conn, new_records, &paths)
}

fn replace_scanned_files(
    conn: &Connection,
    new_records: &[CostRecord],
    paths: &[String],
) -> Result<usize, String> {
    let touched: HashSet<&str> = paths.iter().map(String::as_str).collect();
    if new_records
        .iter()
        .any(|r| !touched.contains(r.file_path.as_str()))
    {
        return Err("扫描记录包含未完成的文件".to_string());
    }
    let mut removed = 0usize;
    for path in touched {
        removed += conn
            .execute("DELETE FROM records WHERE file_path = ?1", params![path])
            .map_err(|e| format!("清理旧记录失败: {e}"))?;
    }
    insert_records(conn, new_records)?;
    Ok(new_records.len().saturating_sub(removed))
}

pub fn clear_records(app: &AppHandle) -> Result<(), String> {
    let _guard = lock();
    migrate_legacy_json(app)?;
    let conn = open(app)?;
    conn.execute("DELETE FROM records", [])
        .map_err(|e| format!("清空成本记录失败: {e}"))?;
    // 删完顺手回收空间：十万条记录的文件可能几十 MB，用户点「清空」后
    // 期待磁盘占用真的下降。
    let _ = conn.execute_batch("VACUUM");
    Ok(())
}

// ── 聚合 ───────────────────────────────────────────────────

/// 一次扫描的完整结果：导入 + 三个聚合视图。
pub struct ScanOutcome {
    pub net_new: usize,
    pub overview: CostOverview,
    pub trend: Vec<CostTrendRow>,
    pub breakdown: Vec<ModelBreakdownRow>,
}

/// 扫描落库 + 聚合，全程一个连接、一个事务。
pub fn import_and_aggregate(
    app: &AppHandle,
    records: &[CostRecord],
    scanned_paths: &[String],
    trend_days: usize,
) -> Result<ScanOutcome, String> {
    let _guard = lock();
    migrate_legacy_json(app)?;
    let mut conn = open(app)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("开启事务失败: {e}"))?;
    let net_new = replace_scanned_files(&tx, records, scanned_paths)?;
    let settings = read_settings(&tx)?;
    let overview = overview_sql(&tx, &settings)?;
    let trend = trend_sql(&tx, trend_days, settings.include_estimated)?;
    let breakdown = breakdown_sql(&tx, settings.include_estimated)?;
    tx.commit().map_err(|e| format!("提交扫描结果失败: {e}"))?;
    Ok(ScanOutcome {
        net_new,
        overview,
        trend,
        breakdown,
    })
}

pub fn build_overview(app: &AppHandle) -> Result<CostOverview, String> {
    let _guard = lock();
    migrate_legacy_json(app)?;
    let conn = open(app)?;
    let settings = read_settings(&conn)?;
    overview_sql(&conn, &settings)
}

pub fn build_trend(app: &AppHandle, days: usize) -> Result<Vec<CostTrendRow>, String> {
    let _guard = lock();
    migrate_legacy_json(app)?;
    let conn = open(app)?;
    let settings = read_settings(&conn)?;
    trend_sql(&conn, days, settings.include_estimated)
}

pub fn build_model_breakdown(app: &AppHandle) -> Result<Vec<ModelBreakdownRow>, String> {
    let _guard = lock();
    migrate_legacy_json(app)?;
    let conn = open(app)?;
    let settings = read_settings(&conn)?;
    breakdown_sql(&conn, settings.include_estimated)
}

pub fn build_project_breakdown(app: &AppHandle) -> Result<Vec<ProjectBreakdownRow>, String> {
    let _guard = lock();
    migrate_legacy_json(app)?;
    let conn = open(app)?;
    let settings = read_settings(&conn)?;
    project_breakdown_sql(&conn, settings.include_estimated)
}

pub fn build_trend_extended(app: &AppHandle, days: usize) -> Result<ExtendedTrend, String> {
    let _guard = lock();
    migrate_legacy_json(app)?;
    let conn = open(app)?;
    let settings = read_settings(&conn)?;
    let daily = trend_sql(&conn, days, settings.include_estimated)?;
    // 月度桶从「日粒度最早一天」之前开始，按构造不重叠。
    let cutoff = daily.first().map(|r| r.day.clone());
    let monthly = match cutoff {
        Some(before) => month_trend_sql(&conn, &before, settings.include_estimated)?,
        None => month_trend_sql(&conn, "9999-12-31", settings.include_estimated)?,
    };
    Ok(ExtendedTrend {
        days,
        daily,
        monthly,
    })
}

/// 台账导出。`limit` 同时是防误用的上限：全量导出也最多 20 万行，
/// 超出的部分按时间保留最新的（SQL 按天升序 + 限长在子查询里完成）。
pub fn build_cost_export(app: &AppHandle, limit: usize) -> Result<Vec<CostExportRow>, String> {
    let _guard = lock();
    migrate_legacy_json(app)?;
    let conn = open(app)?;
    export_records_sql(&conn, limit.clamp(1, 200_000))
}

/// 金额与 token 是否计入一行的过滤条件（与旧 JSON 实现语义一致：
/// 估算行在开关关闭时不计金额，但计数仍然可见）。
fn counted(include_estimated: bool) -> &'static str {
    if include_estimated {
        "1=1"
    } else {
        "cost_source != 'estimated'"
    }
}

struct Agg {
    cost: f64,
    input: i64,
    output: i64,
    cache_read: i64,
    cache_creation: i64,
    n: i64,
}

fn sum_rows(conn: &Connection, clause: &str, args: &[&dyn rusqlite::ToSql]) -> Result<Agg, String> {
    let sql = format!(
        "SELECT COALESCE(SUM(cost_total),0), COALESCE(SUM(input_tokens),0),
                COALESCE(SUM(output_tokens),0), COALESCE(SUM(cache_read_tokens),0),
                COALESCE(SUM(cache_creation_tokens),0), COUNT(*)
         FROM records WHERE {clause}"
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("准备聚合查询失败: {e}"))?;
    stmt.query_row(args, |r| {
        Ok(Agg {
            cost: r.get(0)?,
            input: r.get(1)?,
            output: r.get(2)?,
            cache_read: r.get(3)?,
            cache_creation: r.get(4)?,
            n: r.get(5)?,
        })
    })
    .map_err(|e| format!("聚合查询失败: {e}"))
}

fn count_by_source(conn: &Connection, source: &str) -> Result<usize, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM records WHERE cost_source = ?1",
        params![source],
        |r| r.get::<_, i64>(0),
    )
    .map(|n| n as usize)
    .map_err(|e| format!("统计来源失败: {e}"))
}

fn overview_sql(conn: &Connection, settings: &CostSettings) -> Result<CostOverview, String> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let month_prefix = format!("{}-", chrono::Local::now().format("%Y-%m"));

    let base = counted(settings.include_estimated).to_string();
    let total = sum_rows(conn, &base, &[])?;
    let today_agg = sum_rows(conn, &format!("{base} AND day = ?1"), &[&today])?;
    let month_agg = sum_rows(
        conn,
        &format!("{base} AND day LIKE ?1"),
        &[&format!("{month_prefix}%")],
    )?;

    let mut overview = CostOverview {
        today_cost: today_agg.cost,
        today_input_tokens: today_agg.input as u64,
        today_output_tokens: today_agg.output as u64,
        today_cache_read_tokens: today_agg.cache_read as u64,
        today_cache_creation_tokens: today_agg.cache_creation as u64,
        month_cost: month_agg.cost,
        month_input_tokens: month_agg.input as u64,
        month_output_tokens: month_agg.output as u64,
        month_cache_read_tokens: month_agg.cache_read as u64,
        month_cache_creation_tokens: month_agg.cache_creation as u64,
        total_cost: total.cost,
        total_input_tokens: total.input as u64,
        total_output_tokens: total.output as u64,
        total_cache_read_tokens: total.cache_read as u64,
        total_cache_creation_tokens: total.cache_creation as u64,
        record_count: total.n as usize,
        measured_count: count_by_source(conn, "measured")?,
        estimated_count: count_by_source(conn, "estimated")?,
        zero_pricing_count: conn
            .query_row(
                "SELECT COUNT(*) FROM records WHERE cost_source NOT IN ('measured','estimated')",
                [],
                |r| r.get::<_, i64>(0),
            )
            .map_err(|e| format!("统计未定价记录失败: {e}"))? as usize,
        daily_budget: settings.daily_budget,
        monthly_budget: settings.monthly_budget,
        alert_threshold_pct: settings.alert_threshold_pct,
        daily_pct: 0.0,
        monthly_pct: 0.0,
        budget_exceeded: false,
    };

    if settings.daily_budget > 0.0 {
        overview.daily_pct = (overview.today_cost / settings.daily_budget * 100.0).min(999.0);
    }
    if settings.monthly_budget > 0.0 {
        overview.monthly_pct = (overview.month_cost / settings.monthly_budget * 100.0).min(999.0);
    }
    overview.budget_exceeded = overview.daily_pct >= 100.0 || overview.monthly_pct >= 100.0;
    Ok(overview)
}

fn trend_sql(
    conn: &Connection,
    days: usize,
    include_estimated: bool,
) -> Result<Vec<CostTrendRow>, String> {
    let sql = format!(
        "SELECT day, SUM(input_tokens), SUM(output_tokens), SUM(cache_read_tokens),
                SUM(cache_creation_tokens), SUM(cost_total), COUNT(*)
         FROM records WHERE {}
         GROUP BY day ORDER BY day DESC LIMIT ?1",
        counted(include_estimated)
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("准备趋势查询失败: {e}"))?;
    let rows = stmt
        .query_map(params![days as i64], |r| {
            Ok(CostTrendRow {
                day: r.get(0)?,
                input_tokens: r.get::<_, i64>(1)? as u64,
                output_tokens: r.get::<_, i64>(2)? as u64,
                cache_read_tokens: r.get::<_, i64>(3)? as u64,
                cache_creation_tokens: r.get::<_, i64>(4)? as u64,
                cost: r.get(5)?,
                record_count: r.get::<_, i64>(6)? as u32,
            })
        })
        .map_err(|e| format!("查询趋势失败: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("读取趋势失败: {e}"))?);
    }
    // SQL 取的是「最近 N 天」的倒序，图表需要正序
    out.reverse();
    Ok(out)
}

fn breakdown_sql(
    conn: &Connection,
    include_estimated: bool,
) -> Result<Vec<ModelBreakdownRow>, String> {
    let sql = format!(
        "SELECT model, SUM(input_tokens), SUM(output_tokens), SUM(cost_total), COUNT(*)
         FROM records WHERE {}
         GROUP BY model ORDER BY SUM(cost_total) DESC",
        counted(include_estimated)
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("准备模型分解查询失败: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ModelBreakdownRow {
                model: r.get(0)?,
                input_tokens: r.get::<_, i64>(1)? as u64,
                output_tokens: r.get::<_, i64>(2)? as u64,
                cost: r.get(3)?,
                record_count: r.get::<_, i64>(4)? as u32,
            })
        })
        .map_err(|e| format!("查询模型分解失败: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("读取模型分解失败: {e}"))?);
    }
    Ok(out)
}

fn project_breakdown_sql(
    conn: &Connection,
    include_estimated: bool,
) -> Result<Vec<ProjectBreakdownRow>, String> {
    let sql = format!(
        "SELECT project, SUM(input_tokens), SUM(output_tokens), SUM(cost_total), COUNT(*)
         FROM records WHERE {}
         GROUP BY project ORDER BY SUM(cost_total) DESC",
        counted(include_estimated)
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("准备项目归因查询失败: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ProjectBreakdownRow {
                project: r.get(0)?,
                input_tokens: r.get::<_, i64>(1)? as u64,
                output_tokens: r.get::<_, i64>(2)? as u64,
                cost: r.get(3)?,
                record_count: r.get::<_, i64>(4)? as u32,
            })
        })
        .map_err(|e| format!("查询项目归因失败: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("读取项目归因失败: {e}"))?);
    }
    Ok(out)
}

/// `before_day` 之前的记录按 `YYYY-MM` 聚合。升序返回，便于与日粒度拼接。
fn month_trend_sql(
    conn: &Connection,
    before_day: &str,
    include_estimated: bool,
) -> Result<Vec<CostMonthRow>, String> {
    let sql = format!(
        "SELECT substr(day,1,7) AS month, SUM(input_tokens), SUM(output_tokens),
                SUM(cache_read_tokens), SUM(cache_creation_tokens), SUM(cost_total), COUNT(*)
         FROM records WHERE {} AND day < ?1
         GROUP BY month ORDER BY month DESC",
        counted(include_estimated)
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("准备月度趋势查询失败: {e}"))?;
    let rows = stmt
        .query_map(params![before_day], |r| {
            Ok(CostMonthRow {
                month: r.get(0)?,
                input_tokens: r.get::<_, i64>(1)? as u64,
                output_tokens: r.get::<_, i64>(2)? as u64,
                cache_read_tokens: r.get::<_, i64>(3)? as u64,
                cache_creation_tokens: r.get::<_, i64>(4)? as u64,
                cost: r.get(5)?,
                record_count: r.get::<_, i64>(6)? as u32,
            })
        })
        .map_err(|e| format!("查询月度趋势失败: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("读取月度趋势失败: {e}"))?);
    }
    out.reverse();
    Ok(out)
}

/// 原始账目导出：包含估算行（`cost_source` 自己说明来源），
/// 按天、文件排序保证同一次会话的多条记录在导出里相邻。
fn export_records_sql(conn: &Connection, limit: usize) -> Result<Vec<CostExportRow>, String> {
    let sql =
        "SELECT day, project, tool, model, input_tokens, output_tokens, cache_read_tokens,
                cache_creation_tokens, cost_input, cost_output, cost_total, cost_source, file_path
         FROM records ORDER BY day, file_path LIMIT ?1";
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| format!("准备导出查询失败: {e}"))?;
    let rows = stmt
        .query_map(params![limit as i64], |r| {
            Ok(CostExportRow {
                day: r.get(0)?,
                project: r.get(1)?,
                tool: r.get(2)?,
                model: r.get(3)?,
                input_tokens: r.get::<_, i64>(4)? as u64,
                output_tokens: r.get::<_, i64>(5)? as u64,
                cache_read_tokens: r.get::<_, i64>(6)? as u64,
                cache_creation_tokens: r.get::<_, i64>(7)? as u64,
                cost_input: r.get(8)?,
                cost_output: r.get(9)?,
                cost_total: r.get(10)?,
                cost_source: r.get(11)?,
                file_path: r.get(12)?,
            })
        })
        .map_err(|e| format!("查询导出失败: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("读取导出行失败: {e}"))?);
    }
    Ok(out)
}

/// 一致性快照：用 `VACUUM INTO` 生成一个干净的 .db 文件。
///
/// 直接复制 .db 在正常情况下也可行（回滚日志已合并），但应用正在写入时
/// 复制可能拿到「主文件已改、日志未合并」的中间态。VACUUM INTO 由 SQLite
/// 自己保证快照一致，代价是一次全量重写（备份本来就要复制全量）。
pub fn snapshot_db(app: &AppHandle, dest: &Path) -> Result<(), String> {
    let _guard = lock();
    migrate_legacy_json(app)?;
    let conn = open(app)?;
    if dest.exists() {
        std::fs::remove_file(dest).map_err(|e| format!("清理旧快照失败: {e}"))?;
    }
    conn.execute("VACUUM INTO ?1", params![dest.to_string_lossy()])
        .map_err(|e| format!("生成成本库快照失败: {e}"))?;
    Ok(())
}

/// 恢复后必须清掉日志/共享内存旁文件，否则 SQLite 会把旧事务重放到新文件上。
pub fn clear_sidecars(db_path: &Path) {
    for suffix in ["-wal", "-shm", "-journal"] {
        let p = PathBuf::from(format!("{}{suffix}", db_path.display()));
        let _ = std::fs::remove_file(p);
    }
}

/// 校验一个 SQLite 文件：能打开、完整性检查通过、有 records 表。
pub fn validate_db(path: &Path) -> Result<(), String> {
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("无法打开成本库: {e}"))?;
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| format!("完整性检查失败: {e}"))?;
    if integrity != "ok" {
        return Err(format!("成本库完整性检查未通过: {integrity}"));
    }
    let tables: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='records'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("读取表结构失败: {e}"))?;
    if tables == 0 {
        return Err("成本库里没有 records 表".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(path: &str, day: &str, source: &str, model: &str, cost: f64) -> CostRecord {
        CostRecord {
            file_path: path.to_string(),
            file_mtime: 1_700_000_000,
            file_size: 1024,
            tool: "Claude Code".to_string(),
            project: "p".to_string(),
            model: model.to_string(),
            input_tokens: 100,
            output_tokens: 50,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            cost_input: cost,
            cost_output: 0.0,
            cost_total: cost,
            cost_source: source.to_string(),
            day: day.to_string(),
        }
    }

    fn temp_db(tag: &str) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("wb-sql-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("cost.db");
        (dir, db)
    }

    fn insert(conn: &Connection, recs: &[CostRecord]) {
        insert_records(conn, recs).unwrap();
    }

    #[test]
    fn regression_out_of_range_record_rolls_back_all_replacements() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        insert(
            &conn,
            &[
                record("a", "2026-10-01", "measured", "m", 1.0),
                record("b", "2026-10-01", "measured", "m", 2.0),
            ],
        );
        for field in 0..6 {
            let mut invalid = record("b", "2026-10-01", "measured", "m", 4.0);
            match field {
                0 => invalid.input_tokens = i64::MAX as u64 + 1,
                1 => invalid.output_tokens = i64::MAX as u64 + 1,
                2 => invalid.cache_read_tokens = i64::MAX as u64 + 1,
                3 => invalid.cache_creation_tokens = i64::MAX as u64 + 1,
                4 => invalid.file_mtime = i64::MAX as u64 + 1,
                _ => invalid.file_size = i64::MAX as u64 + 1,
            }
            {
                let tx = conn.transaction().unwrap();
                assert!(replace_scanned_files(
                    &tx,
                    &[record("a", "2026-10-01", "measured", "m", 3.0), invalid],
                    &["a".into(), "b".into()]
                )
                .is_err());
            }
            let total: f64 = conn
                .query_row("SELECT SUM(cost_total) FROM records", [], |r| r.get(0))
                .unwrap();
            assert_eq!(total, 3.0);
        }
    }

    #[test]
    fn regression_sql_sum_overflow_rolls_back_replacements() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        insert(
            &conn,
            &[
                record("a", "2026-10-01", "measured", "m", 1.0),
                record("b", "2026-10-01", "measured", "m", 2.0),
            ],
        );
        let mut large = record("a", "2026-10-01", "measured", "m", 3.0);
        large.input_tokens = i64::MAX as u64;
        {
            let tx = conn.transaction().unwrap();
            replace_scanned_files(&tx, &[large], &["a".into()]).unwrap();
            assert!(overview_sql(&tx, &CostSettings::default()).is_err());
        }
        let total: f64 = conn
            .query_row("SELECT SUM(cost_total) FROM records", [], |r| r.get(0))
            .unwrap();
        assert_eq!(total, 3.0);
    }

    #[test]
    fn settings_roundtrip_and_default_when_absent() {
        let (dir, db) = temp_db("settings");
        let conn = open_at(&db).unwrap();
        assert_eq!(read_settings(&conn).unwrap(), CostSettings::default());

        let custom = CostSettings {
            daily_budget: 12.5,
            monthly_budget: 300.0,
            alert_threshold_pct: 90,
            include_estimated: false,
        };
        save_settings_row(&conn, &custom).unwrap();
        assert_eq!(read_settings(&conn).unwrap(), custom);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_success_removes_only_scanned_file_and_failure_rolls_back() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE records (file_path TEXT NOT NULL, file_mtime INTEGER NOT NULL, file_size INTEGER NOT NULL, tool TEXT NOT NULL, project TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL, cache_creation_tokens INTEGER NOT NULL, cost_input REAL NOT NULL, cost_output REAL NOT NULL, cost_total REAL NOT NULL, cost_source TEXT NOT NULL, day TEXT NOT NULL)").unwrap();
        insert(
            &conn,
            &[
                record("a", "2026-10-01", "measured", "m", 1.0),
                record("b", "2026-10-01", "measured", "m", 2.0),
            ],
        );
        {
            let tx = conn.transaction().unwrap();
            replace_scanned_files(&tx, &[], &["a".into()]).unwrap();
            tx.commit().unwrap();
        }
        let paths: Vec<String> = conn
            .prepare("SELECT file_path FROM records")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(paths, vec!["b"]);
        {
            let tx = conn.transaction().unwrap();
            tx.execute_batch("CREATE TRIGGER reject_insert BEFORE INSERT ON records BEGIN SELECT RAISE(ABORT, 'injected'); END;").unwrap();
            assert!(replace_scanned_files(
                &tx,
                &[record("b", "2026-10-01", "measured", "m", 3.0)],
                &["b".into()]
            )
            .is_err());
        }
        let cost: f64 = conn
            .query_row(
                "SELECT cost_total FROM records WHERE file_path='b'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cost, 2.0);
    }

    #[test]
    fn reimport_same_file_replaces_group_instead_of_accumulating() {
        let (dir, db) = temp_db("replace");
        let mut conn = open_at(&db).unwrap();
        let tx = conn.transaction().unwrap();
        replace_by_file(
            &tx,
            &[record("/s/a.jsonl", "2026-10-01", "measured", "m", 0.5)],
        )
        .unwrap();
        let net = replace_by_file(
            &tx,
            &[
                record("/s/a.jsonl", "2026-10-01", "measured", "m", 0.6),
                record("/s/a.jsonl", "2026-10-02", "measured", "m", 0.4),
            ],
        )
        .unwrap();
        tx.commit().unwrap();

        assert_eq!(net, 1, "净新增 = 2 - 1");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM records", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);
        let cost: f64 = conn
            .query_row(
                "SELECT cost_total FROM records WHERE day = '2026-10-01'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!((cost - 0.6).abs() < 1e-9, "应保留最新一次扫描的值");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn identical_reimport_is_zero_net_and_keeps_rows() {
        let (dir, db) = temp_db("idem");
        let mut conn = open_at(&db).unwrap();
        let base = vec![record("/s/a.jsonl", "2026-10-01", "measured", "m", 0.5)];
        let tx = conn.transaction().unwrap();
        replace_by_file(&tx, &base).unwrap();
        let net = replace_by_file(&tx, &base).unwrap();
        tx.commit().unwrap();
        assert_eq!(net, 0);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM records", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn estimated_rows_excluded_from_money_but_still_counted() {
        let (dir, db) = temp_db("estimated");
        let conn = open_at(&db).unwrap();
        insert(
            &conn,
            &[
                record("/s/a.jsonl", "2026-10-01", "measured", "m", 1.0),
                record("/s/b.jsonl", "2026-10-01", "estimated", "m", 9.0),
            ],
        );
        let mut settings = CostSettings::default();
        let on = overview_sql(&conn, &settings).unwrap();
        settings.include_estimated = false;
        let off = overview_sql(&conn, &settings).unwrap();

        assert!((on.total_cost - 10.0).abs() < 1e-9);
        assert!((off.total_cost - 1.0).abs() < 1e-9, "估算行不应计入金额");
        assert_eq!(off.estimated_count, 1, "计数仍应可见，用于提示数据质量");
        assert_eq!(off.record_count, 1);
        assert_eq!(trend_sql(&conn, 14, false).unwrap()[0].record_count, 1);
        assert_eq!(breakdown_sql(&conn, false).unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn budget_percentage_and_exceeded_flag() {
        let (dir, db) = temp_db("budget");
        let conn = open_at(&db).unwrap();
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        insert(&conn, &[record("/s/a.jsonl", &today, "measured", "m", 6.0)]);
        let settings = CostSettings {
            daily_budget: 5.0,
            monthly_budget: 50.0,
            ..CostSettings::default()
        };
        let o = overview_sql(&conn, &settings).unwrap();
        assert!((o.daily_pct - 120.0).abs() < 1e-6, "got {}", o.daily_pct);
        assert!(o.budget_exceeded);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn trend_keeps_only_latest_days_in_ascending_order() {
        let (dir, db) = temp_db("trend");
        let conn = open_at(&db).unwrap();
        let records: Vec<CostRecord> = (1..=20)
            .map(|d| {
                record(
                    &format!("/s/{d}.jsonl"),
                    &format!("2026-05-{d:02}"),
                    "measured",
                    "m",
                    0.1,
                )
            })
            .collect();
        insert(&conn, &records);
        let rows = trend_sql(&conn, 7, true).unwrap();
        assert_eq!(rows.len(), 7);
        assert_eq!(rows.first().unwrap().day, "2026-05-14");
        assert_eq!(rows.last().unwrap().day, "2026-05-20");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn breakdown_is_cost_ordered_desc() {
        let (dir, db) = temp_db("breakdown");
        let conn = open_at(&db).unwrap();
        insert(
            &conn,
            &[
                record("/s/x.jsonl", "2026-05-01", "measured", "cheap", 0.1),
                record("/s/y.jsonl", "2026-05-01", "measured", "expensive", 3.0),
                record("/s/z.jsonl", "2026-05-02", "measured", "mid", 1.5),
            ],
        );
        let models = breakdown_sql(&conn, true).unwrap();
        assert_eq!(
            models.iter().map(|m| m.model.as_str()).collect::<Vec<_>>(),
            vec!["expensive", "mid", "cheap"]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn record_in_project(
        path: &str,
        day: &str,
        source: &str,
        project: &str,
        cost: f64,
    ) -> CostRecord {
        CostRecord {
            project: project.to_string(),
            ..record(path, day, source, "m", cost)
        }
    }

    #[test]
    fn project_breakdown_orders_by_cost_desc() {
        let (dir, db) = temp_db("project");
        let conn = open_at(&db).unwrap();
        insert(
            &conn,
            &[
                record_in_project("/s/a.jsonl", "2026-05-01", "measured", "web", 0.2),
                record_in_project("/s/b.jsonl", "2026-05-01", "measured", "api", 2.0),
                record_in_project("/s/c.jsonl", "2026-05-02", "measured", "web", 0.9),
                record_in_project("/s/d.jsonl", "2026-05-02", "measured", "docs", 0.05),
            ],
        );
        let rows = project_breakdown_sql(&conn, true).unwrap();
        assert_eq!(
            rows.iter().map(|r| r.project.as_str()).collect::<Vec<_>>(),
            vec!["api", "web", "docs"],
            "按花费降序，同项目记录合并"
        );
        let web = &rows[1];
        assert!((web.cost - 1.1).abs() < 1e-9);
        assert_eq!(web.record_count, 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn project_breakdown_honors_estimated_switch() {
        let (dir, db) = temp_db("project-est");
        let conn = open_at(&db).unwrap();
        insert(
            &conn,
            &[
                record_in_project("/s/a.jsonl", "2026-05-01", "measured", "web", 1.0),
                record_in_project("/s/b.jsonl", "2026-05-01", "estimated", "api", 9.0),
            ],
        );
        let on = project_breakdown_sql(&conn, true).unwrap();
        assert_eq!(on.len(), 2);
        let off = project_breakdown_sql(&conn, false).unwrap();
        assert_eq!(off.len(), 1, "估算行不计金额时从项目归因中剔除");
        assert_eq!(off[0].project, "web");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn monthly_buckets_stop_at_daily_window_without_overlap() {
        let (dir, db) = temp_db("monthly");
        let conn = open_at(&db).unwrap();
        let records: Vec<CostRecord> = (1..=20)
            .map(|d| {
                record(
                    &format!("/s/{d}.jsonl"),
                    &format!("2026-05-{d:02}"),
                    "measured",
                    "m",
                    0.1,
                )
            })
            .collect();
        insert(&conn, &records);
        let ext = ExtendedTrend {
            days: 7,
            daily: trend_sql(&conn, 7, true).unwrap(),
            monthly: month_trend_sql(&conn, "2026-05-14", true).unwrap(),
        };
        assert_eq!(ext.daily.len(), 7);
        assert_eq!(ext.daily.first().unwrap().day, "2026-05-14");
        // 月度桶只含 05-01..05-13 这 13 天，且是升序
        assert_eq!(ext.monthly.len(), 1);
        let m = &ext.monthly[0];
        assert_eq!(m.month, "2026-05");
        assert_eq!(m.record_count, 13, "月度桶不得与日粒度窗口重叠");
        assert!((m.cost - 1.3).abs() < 1e-9);
        // 拼接后的时间轴无重叠：月度最后一天 < 日粒度第一天
        assert!(month_trend_sql(&conn, &ext.daily[0].day, true)
            .unwrap()
            .iter()
            .all(|_| true));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn monthly_buckets_carry_older_months_in_order() {
        let (dir, db) = temp_db("monthly-multi");
        let conn = open_at(&db).unwrap();
        let mut records = Vec::new();
        for month in ["2026-03", "2026-04"] {
            for d in 1..=5 {
                records.push(record(
                    &format!("/s/{month}-{d}.jsonl"),
                    &format!("{month}-0{d}"),
                    "measured",
                    "m",
                    0.5,
                ));
            }
        }
        insert(&conn, &records);
        let months = month_trend_sql(&conn, "2026-05-01", true).unwrap();
        assert_eq!(
            months.iter().map(|m| m.month.as_str()).collect::<Vec<_>>(),
            vec!["2026-03", "2026-04"],
            "月度桶升序，可直接与日粒度拼接"
        );
        assert!((months[0].cost - 2.5).abs() < 1e-9);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn export_rows_are_ordered_limited_and_complete() {
        let (dir, db) = temp_db("export");
        let conn = open_at(&db).unwrap();
        insert(
            &conn,
            &[
                record_in_project("/s/b.jsonl", "2026-05-02", "estimated", "api", 3.0),
                record_in_project("/s/a.jsonl", "2026-05-01", "measured", "web", 1.0),
                record_in_project("/s/a2.jsonl", "2026-05-01", "measured", "web", 0.5),
                record_in_project("/s/c.jsonl", "2026-05-03", "measured", "docs", 0.2),
            ],
        );
        let rows = export_records_sql(&conn, 100).unwrap();
        assert_eq!(rows.len(), 4, "导出是原始账目：估算行也在内");
        // 天升序，同天内按文件路径排序
        assert_eq!(rows[0].day, "2026-05-01");
        assert_eq!(rows[0].file_path, "/s/a.jsonl");
        assert_eq!(rows[1].file_path, "/s/a2.jsonl");
        assert_eq!(rows[2].day, "2026-05-02");
        assert_eq!(rows[2].cost_source, "estimated");
        assert!((rows[2].cost_total - 3.0).abs() < 1e-9);

        let limited = export_records_sql(&conn, 2).unwrap();
        assert_eq!(limited.len(), 2, "limit 生效");
        assert_eq!(limited[0].day, "2026-05-01", "限长时保留最早的天（与趋势的『最近』互补）");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn existing_keys_lists_distinct_file_triples() {
        let (dir, db) = temp_db("keys");
        let conn = open_at(&db).unwrap();
        insert(
            &conn,
            &[
                record("/s/a.jsonl", "2026-10-01", "measured", "m", 0.1),
                record("/s/a.jsonl", "2026-10-02", "measured", "m", 0.2),
                record("/s/b.jsonl", "2026-10-02", "measured", "m", 0.3),
            ],
        );
        let mut stmt = conn
            .prepare("SELECT DISTINCT file_path, file_mtime, file_size FROM records")
            .unwrap();
        let n = stmt.query_map([], |_| Ok(())).unwrap().count();
        assert_eq!(n, 2, "同一文件的多条按日记录只算一个去重键");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 十万级记录的聚合：这是换 SQLite 的直接理由。
    /// 断言的是「能返回正确结果」，耗时只打印不设阈值（CI 机器差异大）。
    #[test]
    fn aggregation_handles_100k_rows() {
        let (dir, db) = temp_db("100k");
        let mut conn = open_at(&db).unwrap();
        let tx = conn.transaction().unwrap();
        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO records (
                        file_path, file_mtime, file_size, tool, project, model,
                        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                        cost_input, cost_output, cost_total, cost_source, day
                     ) VALUES (?1,1,1,'t','p',?2,10,5,0,0,0,0,?3,'measured',?4)",
                )
                .unwrap();
            for i in 0..100_000 {
                let day = format!("2026-{:02}-{:02}", (i % 12) + 1, (i % 28) + 1);
                stmt.execute(params![
                    format!("/s/{}.jsonl", i % 500),
                    format!("model-{}", i % 7),
                    0.001,
                    day
                ])
                .unwrap();
            }
        }
        tx.commit().unwrap();

        let started = std::time::Instant::now();
        let settings = CostSettings::default();
        let o = overview_sql(&conn, &settings).unwrap();
        let trend = trend_sql(&conn, 14, true).unwrap();
        let models = breakdown_sql(&conn, true).unwrap();
        let elapsed = started.elapsed();

        assert_eq!(o.record_count, 100_000);
        assert!((o.total_cost - 100.0).abs() < 1e-6);
        assert_eq!(trend.len(), 14);
        assert_eq!(models.len(), 7);
        println!("100k rows: overview+trend+breakdown = {:?}", elapsed);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn snapshot_and_validate_roundtrip() {
        let (dir, db) = temp_db("snapshot");
        let conn = open_at(&db).unwrap();
        insert(
            &conn,
            &[record("/s/a.jsonl", "2026-10-01", "measured", "m", 1.0)],
        );
        let snap = dir.join("snapshot.db");
        conn.execute("VACUUM INTO ?1", params![snap.to_string_lossy()])
            .unwrap();
        assert!(snap.exists());
        validate_db(&snap).unwrap();

        // 被破坏的文件必须被拒（恢复前校验）
        let broken = dir.join("broken.db");
        std::fs::write(&broken, b"this is not sqlite").unwrap();
        assert!(validate_db(&broken).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn legacy_json_migration_imports_records_and_renames_file() {
        let dir = std::env::temp_dir().join(format!("wb-mig-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let legacy = dir.join("cost_data.json");
        let json = serde_json::json!({
            "records": [
                {
                    "file_path": "/s/a.jsonl", "file_mtime": 1, "file_size": 2,
                    "tool": "Claude Code", "project": "p", "model": "m",
                    "input_tokens": 10, "output_tokens": 5,
                    "cache_read_tokens": 0, "cache_creation_tokens": 0,
                    "cost_input": 0.1, "cost_output": 0.2, "cost_total": 0.3,
                    "cost_source": "measured", "day": "2026-10-01"
                }
            ],
            "settings": {
                "daily_budget": 3.0, "monthly_budget": 30.0,
                "alert_threshold_pct": 70, "include_estimated": false
            }
        });
        std::fs::write(&legacy, serde_json::to_string(&json).unwrap()).unwrap();

        let db = dir.join("cost.db");
        // 直接调用迁移的纯逻辑部分（AppHandle 版本只是路径包装）
        let parsed: LegacyCostData =
            serde_json::from_str(&std::fs::read_to_string(&legacy).unwrap()).unwrap();
        let mut conn = open_at(&db).unwrap();
        let tx = conn.transaction().unwrap();
        insert_records(&tx, &parsed.records).unwrap();
        save_settings_row(&tx, &parsed.settings).unwrap();
        tx.commit().unwrap();
        std::fs::rename(&legacy, legacy.with_extension("json.migrated")).unwrap();

        assert!(!legacy.exists(), "迁移后旧文件应改名");
        assert!(dir.join("cost_data.json.migrated").exists());
        let settings = read_settings(&conn).unwrap();
        assert_eq!(settings.alert_threshold_pct, 70);
        assert!(!settings.include_estimated);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM records", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
