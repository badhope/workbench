//! Session 计费：从 JSONL 会话文件中提取 token usage 并计算成本
//!
//! 支持的格式：
//! - Claude Code (~/.claude/projects/**/*.jsonl): 顶层 model 字段 + message.usage + 行级 timestamp
//! - Codex CLI (~/.codex/sessions/**/*.jsonl): 滚动日志格式
//! - 通用 fallback: 启发式估算（4 chars/token）
//!
//! 设计：三级降级
//!   1) 有 usage 字段（measured）—— 按行级 timestamp 分日聚合，跨天会话不再整记到 mtime 日
//!   2) 无 usage 但有内容，按字符数启发式估算（estimated）
//!   3) 什么都没有（zero_pricing）
//!
//! 计价语义：Anthropic 的 input_tokens 不含 cache_read/cache_creation（三者互斥），
//! 因此不做减法，cache 分量单独按折扣/溢价计价（见 pricing.rs::calc_cost）。

use serde::Serialize;
use std::collections::HashMap;
#[cfg(test)]
use std::fs;

use crate::cost_store::CostRecord;
use crate::pricing::PricingTable;

/// 单日聚合的用量。
#[derive(Debug, Clone, PartialEq)]
pub struct UsageAgg {
    pub day: String,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_creation: u64,
    /// "measured" | "estimated" | "zero_pricing"
    pub source: String,
}

/// 一个文件按 (日期, 模型) 聚合后的用量。
///
/// 为什么按模型分组而不是「一个文件一个模型」：同一会话里主对话用 opus、
/// 子任务用 haiku 是常态，用第一个读到的模型给整个文件定价会把 haiku 的
/// 用量按 opus 的价格算（贵 10 倍以上）。每行 usage 自带模型，直接分组即可。
#[derive(Debug, Clone, PartialEq)]
pub struct ModelUsage {
    pub model: String,
    pub aggs: Vec<UsageAgg>,
}

/// 从单个 JSONL 文件提取按 (模型, 日期) 聚合的用量。
/// `mtime_day`：文件 mtime 对应日期，作为无行级时间戳时的兜底归属日。
#[cfg(test)]
pub fn extract_usage(path: &str, mtime_day: &str) -> Vec<ModelUsage> {
    extract_usage_inner(path, mtime_day, false).unwrap_or_default()
}

#[cfg(test)]
fn extract_usage_inner(
    path: &str,
    mtime_day: &str,
    strict: bool,
) -> Result<Vec<ModelUsage>, String> {
    extract_usage_with_hook(
        path,
        mtime_day,
        strict,
        &mut ScanReadBudget::new(256 * 1024 * 1024),
        || {},
    )
}

fn extract_usage_with_hook(
    path: &str,
    mtime_day: &str,
    strict: bool,
    budget: &mut ScanReadBudget,
    after_open: impl FnOnce(),
) -> Result<Vec<ModelUsage>, String> {
    let file = crate::ai::open_session_file(std::path::Path::new(path)).map_err(str::to_string)?;
    let before = file
        .metadata()
        .map_err(|_| "session file metadata error".to_string())?;
    after_open();
    let mut reader = crate::ai::SessionReader::with_budget(file, budget);
    // (day, model) -> 用量
    let mut by_day_model: HashMap<(String, String), UsageAgg> = HashMap::new();
    let mut chars_by_day: HashMap<String, usize> = HashMap::new();
    // 按日兜底用的模型：优先取最后见到的已知模型（比「第一个」更贴近当前会话）
    let mut last_known_model: Option<String> = None;
    let mut found_usage = false;
    let mut latest_day: Option<String> = None;

    while let Some(line) = reader.next_line().map_err(str::to_string)? {
        if line.trim().is_empty() {
            continue;
        }
        let value: serde_json::Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(err) => {
                if strict {
                    return Err(format!("解析会话 JSON 失败: {err}"));
                }
                continue;
            }
        };

        // 归属日：行级 timestamp 优先；取不到就挂到已见到的最近一天，最后兜底 mtime 日。
        let day = line_day(&value)
            .or_else(|| latest_day.clone())
            .unwrap_or_else(|| mtime_day.to_string());
        if latest_day.as_deref().is_none_or(|prev| day.as_str() > prev) {
            latest_day = Some(day.clone());
        }
        let chars = chars_by_day.entry(day.clone()).or_insert(0);
        *chars = chars
            .checked_add(line.chars().count())
            .ok_or_else(|| "会话字符数溢出".to_string())?;

        // 行级模型：Claude Code 在 message.model，Codex 在 turn_context.payload.model
        let line_model = model_from_value(&value);
        if let Some(m) = &line_model {
            last_known_model = Some(m.clone());
        }

        let Some(usage) = parse_usage_from_value(&value, strict)? else {
            continue;
        };
        found_usage = true;
        if usage.is_empty() {
            continue;
        }
        let model = line_model
            .or_else(|| last_known_model.clone())
            .unwrap_or_else(|| "unknown".to_string());
        let agg = by_day_model
            .entry((day.clone(), model))
            .or_insert_with(|| zero_agg(&day, "measured"));
        let add = |a: u64, b: u64| {
            a.checked_add(b)
                .filter(|n| *n <= i64::MAX as u64)
                .ok_or_else(|| "会话 token 数超出数据库范围".to_string())
        };
        agg.input = add(agg.input, usage.input)?;
        agg.output = add(agg.output, usage.output)?;
        agg.cache_read = add(agg.cache_read, usage.cache_read)?;
        agg.cache_creation = add(agg.cache_creation, usage.cache_creation)?;
    }

    crate::ai::check_session_unchanged(&before, reader.file()).map_err(str::to_string)?;

    if found_usage {
        return Ok(group_by_model(by_day_model));
    }

    // 降级：按日分桶的字符估算（4 chars/token 是业界常用经验值）。
    // 只对**没有 usage 字段**的文件生效；分桶而不是整文件记到 mtime 日，
    // 保证追写只改变最新一天的桶，趋势图不会自己重写历史。
    let model = last_known_model.unwrap_or_else(|| "unknown".to_string());
    let mut aggs: Vec<UsageAgg> = chars_by_day
        .into_iter()
        .filter_map(|(day, chars)| {
            let total = (chars / 4) as u64;
            if total == 0 {
                return None;
            }
            let input = total / 10 * 6 + total % 10 * 6 / 10;
            Some(UsageAgg {
                day,
                input,
                output: total - input,
                cache_read: 0,
                cache_creation: 0,
                source: "estimated".to_string(),
            })
        })
        .collect();
    if aggs.is_empty() {
        // 空文件 / 全是空白行：没有可计量内容，不产出记录
        return Ok(Vec::new());
    }
    aggs.sort_by(|a, b| a.day.cmp(&b.day));
    Ok(vec![ModelUsage { model, aggs }])
}

/// (day, model) 映射 → 按模型分组、组内按日期排序。
fn group_by_model(by_day_model: HashMap<(String, String), UsageAgg>) -> Vec<ModelUsage> {
    let mut by_model: HashMap<String, Vec<UsageAgg>> = HashMap::new();
    for ((_, model), agg) in by_day_model {
        by_model.entry(model).or_default().push(agg);
    }
    let mut out: Vec<ModelUsage> = by_model
        .into_iter()
        .map(|(model, mut aggs)| {
            aggs.sort_by(|a, b| a.day.cmp(&b.day));
            ModelUsage { model, aggs }
        })
        .collect();
    // 输出顺序稳定：按模型名排序，避免 HashMap 迭代顺序导致测试/日志抖动
    out.sort_by(|a, b| a.model.cmp(&b.model));
    out
}

fn zero_agg(day: &str, source: &str) -> UsageAgg {
    UsageAgg {
        day: day.to_string(),
        input: 0,
        output: 0,
        cache_read: 0,
        cache_creation: 0,
        source: source.to_string(),
    }
}

/// 从一行 JSON 提取模型名。
///
/// 真实格式（此前只读顶层 `model`，导致真实会话全部取不到模型、被判为
/// zero_pricing，整个成本面板显示 $0）：
/// - Claude Code: `{"type":"assistant","message":{"model":"claude-sonnet-4-5",...}}`
/// - Codex:       `{"type":"turn_context","payload":{"model":"gpt-5-codex",...}}`
/// - 顶层 `model` / `manifest.model`：保留兼容
/// - `<synthetic>` 是工具合成消息，不可定价，视为「无模型」
fn model_from_value(v: &serde_json::Value) -> Option<String> {
    let candidates = [
        v.get("model"),
        v.get("message").and_then(|m| m.get("model")),
        v.get("payload").and_then(|p| p.get("model")),
        v.get("manifest").and_then(|m| m.get("model")),
    ];
    for c in candidates.into_iter().flatten() {
        let Some(m) = c.as_str() else { continue };
        let trimmed = m.trim();
        if !trimmed.is_empty() && trimmed != "<synthetic>" {
            return Some(trimmed.to_string());
        }
    }
    None
}

/// 行级时间戳 → 本地日期（YYYY-MM-DD）。支持 RFC3339 字符串、秒/毫秒数值、time.created。
fn line_day(v: &serde_json::Value) -> Option<String> {
    let to_day = |secs: i64| -> Option<String> {
        chrono::DateTime::from_timestamp(secs, 0).map(|dt| {
            dt.with_timezone(&chrono::Local)
                .format("%Y-%m-%d")
                .to_string()
        })
    };
    let ts = v.get("timestamp").or_else(|| v.get("time"))?;
    if let Some(s) = ts.as_str() {
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
            return Some(
                dt.with_timezone(&chrono::Local)
                    .format("%Y-%m-%d")
                    .to_string(),
            );
        }
        if let Ok(naive) = s.parse::<i64>() {
            return to_day(normalize_epoch(naive));
        }
        return None;
    }
    if let Some(n) = ts.as_i64() {
        return to_day(normalize_epoch(n));
    }
    // opencode 风格：time: { created: <ms> }
    ts.get("created")
        .and_then(|c| c.as_i64())
        .and_then(|n| to_day(normalize_epoch(n)))
}

/// 秒 / 毫秒时间戳统一为秒。
fn normalize_epoch(n: i64) -> i64 {
    if n > 1_000_000_000_000 {
        n / 1000
    } else {
        n
    }
}

/// 一条 usage 的四个分量。
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Usage {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_creation: u64,
}

impl Usage {
    fn is_empty(&self) -> bool {
        self.input == 0 && self.output == 0 && self.cache_read == 0 && self.cache_creation == 0
    }
}

/// 从一行 JSONL 提取 usage：兼容 Claude Code（message.usage）、OpenAI 风格
/// （顶层 usage + prompt/completion_tokens）与驼峰命名。生产路径与单测共用同一实现，
/// 避免「测的是生产不跑的函数」这种假信心。
#[cfg(test)]
fn usage_from_value(v: &serde_json::Value) -> Option<Usage> {
    parse_usage_from_value(v, false).ok().flatten()
}

fn parse_usage_from_value(v: &serde_json::Value, strict: bool) -> Result<Option<Usage>, String> {
    // Codex rollout 的用量在 `payload.info.total_token_usage`（token_count 事件），
    // 不在 `message.usage`。只查后者会让 Codex 会话全部退化成字符估算：
    // 模型名读得到、token 却在猜，是最容易被误信的「假精确」。
    let usage = v
        .get("message")
        .and_then(|m| m.get("usage"))
        .or_else(|| v.get("usage"))
        .or_else(|| {
            v.get("payload")
                .and_then(|p| p.get("info"))
                .and_then(|i| i.get("total_token_usage"))
        });
    let Some(usage) = usage else {
        return Ok(None);
    };
    let keys = [
        "input_tokens",
        "inputTokens",
        "prompt_tokens",
        "output_tokens",
        "outputTokens",
        "completion_tokens",
        "cache_read_input_tokens",
        "cache_creation_input_tokens",
        "cached_input_tokens",
        "reasoning_output_tokens",
    ];
    if strict {
        for key in keys {
            if let Some(value) = usage.get(key) {
                if !usage_token_u64(Some(value)).is_some_and(|n| n <= i64::MAX as u64) {
                    return Err(format!("无效的会话 token 字段: {key}"));
                }
            }
        }
    }
    if !keys
        .iter()
        .any(|key| usage_token_u64(usage.get(*key)).is_some())
    {
        return Ok(None);
    }
    let pick = |keys: [&str; 3]| -> u64 {
        keys.iter()
            .filter_map(|k| usage_token_u64(usage.get(*k)))
            .next()
            .unwrap_or(0)
    };
    let input = pick(["input_tokens", "inputTokens", "prompt_tokens"]);
    let output = pick(["output_tokens", "outputTokens", "completion_tokens"]);
    let cache_read = usage_token_u64(usage.get("cache_read_input_tokens"))
        .or_else(|| usage_token_u64(usage.get("cached_input_tokens")))
        .unwrap_or(0);
    let cache_creation = usage_token_u64(usage.get("cache_creation_input_tokens")).unwrap_or(0);
    Ok(Some(Usage {
        input,
        output,
        cache_read,
        cache_creation,
    }))
}

fn usage_token_u64(v: Option<&serde_json::Value>) -> Option<u64> {
    match v {
        Some(serde_json::Value::Number(n)) => n.as_u64(),
        Some(serde_json::Value::String(s)) => s.parse::<u64>().ok(),
        _ => None,
    }
}

#[cfg(test)]
fn scan_sessions_to_records(
    files: &[SessionFileEntry],
    table: &PricingTable,
    _existing_keys: &HashMap<(String, u64, u64), ()>,
) -> Vec<CostRecord> {
    scan_complete_sessions(files, table).unwrap_or_default()
}

pub struct ScanReadBudget {
    pub(crate) remaining: u64,
}

impl ScanReadBudget {
    pub fn new(bytes: u64) -> Self {
        Self { remaining: bytes }
    }

    pub fn remaining(&self) -> u64 {
        self.remaining
    }
}

pub fn scan_complete_sessions(
    files: &[SessionFileEntry],
    table: &PricingTable,
) -> Result<Vec<CostRecord>, String> {
    scan_complete_sessions_with_budget(files, table, &mut ScanReadBudget::new(256 * 1024 * 1024))
}

pub fn scan_complete_sessions_with_budget(
    files: &[SessionFileEntry],
    table: &PricingTable,
    budget: &mut ScanReadBudget,
) -> Result<Vec<CostRecord>, String> {
    let mut records = Vec::new();
    for f in files {
        let mtime_day = unix_to_day(f.modified);
        for ModelUsage { model, aggs } in
            extract_usage_with_hook(&f.path, &mtime_day, true, budget, || {})?
        {
            let priced = table.is_priced(&model);
            for agg in aggs {
                let (cost_inp, cost_out, cost_total) = table.calc_cost(
                    &model,
                    agg.input,
                    agg.output,
                    agg.cache_read,
                    agg.cache_creation,
                );
                // 查不到单价的型号：一律记 zero_pricing，绝不让它伪装成「花了 $0.00」的有效账单
                let source = if priced {
                    agg.source
                } else {
                    "zero_pricing".to_string()
                };
                records.push(CostRecord {
                    file_path: f.path.clone(),
                    file_mtime: f.modified,
                    file_size: f.size,
                    tool: f.tool.clone(),
                    project: f.project.clone(),
                    model: model.clone(),
                    input_tokens: agg.input,
                    output_tokens: agg.output,
                    cache_read_tokens: agg.cache_read,
                    cache_creation_tokens: agg.cache_creation,
                    cost_input: round3(cost_inp),
                    cost_output: round3(cost_out),
                    cost_total: round3(cost_total),
                    cost_source: source,
                    day: agg.day,
                });
            }
        }
    }
    Ok(records)
}

fn unix_to_day(unix_secs: u64) -> String {
    let dt = chrono::DateTime::from_timestamp(unix_secs as i64, 0)
        .unwrap_or(chrono::DateTime::UNIX_EPOCH);
    dt.with_timezone(&chrono::Local)
        .format("%Y-%m-%d")
        .to_string()
}

fn round3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

/// 简化的 session 文件描述（给 batch 扫描用）
#[derive(Clone, Debug, Serialize)]
pub struct SessionFileEntry {
    pub path: String,
    pub tool: String,
    pub project: String,
    pub modified: u64,
    pub size: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(std::path::PathBuf);

    impl Fixture {
        fn new(contents: &str) -> Self {
            use std::sync::atomic::{AtomicU64, Ordering};
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("target")
                .join(format!(
                    "session-meter-{}-{}.jsonl",
                    std::process::id(),
                    NEXT.fetch_add(1, Ordering::Relaxed)
                ));
            fs::write(&path, contents).unwrap();
            Self(path)
        }

        fn extract(&self) -> Vec<ModelUsage> {
            extract_usage(self.0.to_str().unwrap(), "2026-01-01")
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }

    fn entry(fixture: &Fixture) -> SessionFileEntry {
        SessionFileEntry {
            path: fixture.0.to_string_lossy().into_owned(),
            tool: "test".into(),
            project: "test".into(),
            modified: 1,
            size: 0,
        }
    }

    #[test]
    fn shared_read_budget_counts_failed_and_buffered_reads() {
        let bad = Fixture::new("!\n{}\n");
        let good = Fixture::new("{}\n");
        let mut budget = ScanReadBudget::new(8);
        assert!(scan_complete_sessions_with_budget(
            &[entry(&bad)],
            &PricingTable::default(),
            &mut budget
        )
        .is_err());
        assert_eq!(budget.remaining(), 3);
        assert!(scan_complete_sessions_with_budget(
            &[entry(&good)],
            &PricingTable::default(),
            &mut budget
        )
        .is_ok());
        assert_eq!(budget.remaining(), 0);
        assert!(scan_complete_sessions_with_budget(
            &[entry(&good)],
            &PricingTable::default(),
            &mut budget
        )
        .is_err());
    }

    #[test]
    fn shared_read_budget_enforces_exact_and_stale_size_boundaries() {
        let fixture = Fixture::new("{}\n{}\n");
        let mut exact = ScanReadBudget::new(6);
        assert!(scan_complete_sessions_with_budget(
            &[entry(&fixture)],
            &PricingTable::default(),
            &mut exact
        )
        .is_ok());
        assert_eq!(exact.remaining(), 0);
        let mut short = ScanReadBudget::new(5);
        assert!(scan_complete_sessions_with_budget(
            &[entry(&fixture)],
            &PricingTable::default(),
            &mut short
        )
        .is_err());
        assert_eq!(short.remaining(), 0);
        let mut empty = ScanReadBudget::new(0);
        let empty_file = Fixture::new("");
        assert!(scan_complete_sessions_with_budget(
            &[entry(&empty_file)],
            &PricingTable::default(),
            &mut empty
        )
        .is_ok());
    }

    #[test]
    fn shared_read_budget_counts_growth_after_open() {
        let fixture = Fixture::new("{}\n");
        let mut budget = ScanReadBudget::new(4);
        let result = extract_usage_with_hook(
            fixture.0.to_str().unwrap(),
            "2026-01-01",
            true,
            &mut budget,
            || {
                use std::io::Write;
                fs::OpenOptions::new()
                    .append(true)
                    .open(&fixture.0)
                    .unwrap()
                    .write_all(b"{}\n")
                    .unwrap();
            },
        );
        assert!(result.is_err());
        assert_eq!(budget.remaining(), 0);
    }

    #[test]
    fn total_read_budget_rejects_stale_enumerated_sizes() {
        let line = format!("\"{}\"\n", "x".repeat(128 * 1024 - 3));
        let content = line.repeat(256);
        let fixtures: Vec<_> = (0..9).map(|_| Fixture::new(&content)).collect();
        let entries: Vec<_> = fixtures
            .iter()
            .map(|fixture| SessionFileEntry {
                path: fixture.0.to_string_lossy().into_owned(),
                tool: "test".into(),
                project: "test".into(),
                modified: 1,
                size: 0,
            })
            .collect();
        assert!(scan_complete_sessions(&entries, &PricingTable::default()).is_err());
    }

    #[test]
    fn regression_mixed_zero_and_overflow_fails_closed() {
        let fixture =
            Fixture::new(r#"{"usage":{"input_tokens":"18446744073709551616","output_tokens":0}}"#);
        let entry = SessionFileEntry {
            path: fixture.0.to_string_lossy().into_owned(),
            tool: "test".into(),
            project: "test".into(),
            modified: 1,
            size: 0,
        };
        assert!(scan_complete_sessions(&[entry], &PricingTable::default()).is_err());
    }

    #[test]
    fn regression_invalid_tokens_fail_closed() {
        let fields = [
            "input_tokens",
            "inputTokens",
            "prompt_tokens",
            "output_tokens",
            "outputTokens",
            "completion_tokens",
            "cache_read_input_tokens",
            "cache_creation_input_tokens",
        ];
        for field in fields {
            for value in [
                r#""18446744073709551616""#,
                "18446744073709551616",
                "-1",
                r#""-1""#,
                "null",
                "true",
                "{}",
                "[]",
                "1.5",
                r#""invalid""#,
            ] {
                let fixture = Fixture::new(&format!(r#"{{"usage":{{"{field}":{value}}}}}"#));
                let entry = SessionFileEntry {
                    path: fixture.0.to_string_lossy().into_owned(),
                    tool: "test".into(),
                    project: "test".into(),
                    modified: 1,
                    size: 0,
                };
                assert!(
                    scan_complete_sessions(&[entry], &PricingTable::default()).is_err(),
                    "{field}: {value}"
                );
            }
        }
        for contents in [
            r#"{"usage":{"input_tokens":"18446744073709551616","output_tokens":0}}"#,
            r#"{"usage":{"input_tokens":0,"inputTokens":-1}}"#,
            r#"{"usage":{"input_tokens":0,"inputTokens":9223372036854775808}}"#,
        ] {
            let fixture = Fixture::new(contents);
            let entry = SessionFileEntry {
                path: fixture.0.to_string_lossy().into_owned(),
                tool: "test".into(),
                project: "test".into(),
                modified: 1,
                size: 0,
            };
            assert!(
                scan_complete_sessions(&[entry], &PricingTable::default()).is_err(),
                "{contents}"
            );
        }
        for contents in [
            r#"{"usage":{"input_tokens":0,"output_tokens":"0"}}"#,
            r#"{"usage":{}}"#,
            r#"{"content":"no usage"}"#,
        ] {
            let fixture = Fixture::new(contents);
            let entry = SessionFileEntry {
                path: fixture.0.to_string_lossy().into_owned(),
                tool: "test".into(),
                project: "test".into(),
                modified: 1,
                size: 0,
            };
            let records = scan_complete_sessions(&[entry], &PricingTable::default()).unwrap();
            if contents.contains("input_tokens") {
                assert!(records.is_empty());
            } else {
                assert_eq!(records.len(), 1);
            }
        }
    }

    #[test]
    fn regression_scan_rejects_token_overflow() {
        for field in [
            "input_tokens",
            "output_tokens",
            "cache_read_input_tokens",
            "cache_creation_input_tokens",
        ] {
            for value in ["9223372036854775808", "18446744073709551615"] {
                let fixture = Fixture::new(&format!("{{\"usage\":{{\"{field}\":{value}}}}}"));
                let entry = SessionFileEntry {
                    path: fixture.0.to_string_lossy().into_owned(),
                    tool: "test".into(),
                    project: "test".into(),
                    modified: 1,
                    size: 0,
                };
                assert!(
                    scan_complete_sessions(&[entry], &PricingTable::default()).is_err(),
                    "{field}: {value}"
                );
            }
            let fixture = Fixture::new(&format!("{{\"usage\":{{\"{field}\":9223372036854775807}}}}\n{{\"usage\":{{\"{field}\":1}}}}"));
            let entry = SessionFileEntry {
                path: fixture.0.to_string_lossy().into_owned(),
                tool: "test".into(),
                project: "test".into(),
                modified: 1,
                size: 0,
            };
            assert!(
                scan_complete_sessions(&[entry], &PricingTable::default()).is_err(),
                "aggregate {field}"
            );
        }
    }

    #[test]
    fn regression_rejects_file_changed_during_read() {
        use std::io::Write;
        let fixture = Fixture::new("{\"usage\":{\"input_tokens\":1}}\n");
        let path = fixture.0.to_str().unwrap();
        let result = extract_usage_with_hook(
            path,
            "2026-01-01",
            true,
            &mut ScanReadBudget::new(256 * 1024 * 1024),
            || {
                let mut file = fs::OpenOptions::new().append(true).open(path).unwrap();
                file.write_all(b" ").unwrap();
                file.flush().unwrap();
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn regression_same_metadata_content_change_must_be_rescanned() {
        let fixture = Fixture::new(r#"{"model":"gpt-5","usage":{"input_tokens":1000000}}"#);
        let entry = SessionFileEntry {
            path: fixture.0.to_str().unwrap().to_string(),
            tool: "fixture".into(),
            project: "fixture".into(),
            modified: 1,
            size: fs::metadata(&fixture.0).unwrap().len(),
        };
        let first = scan_sessions_to_records(
            std::slice::from_ref(&entry),
            &PricingTable::default(),
            &HashMap::new(),
        );
        assert_eq!(first[0].input_tokens, 1_000_000);
        fs::write(
            &fixture.0,
            r#"{"model":"gpt-5","usage":{"input_tokens":2000000}}"#,
        )
        .unwrap();
        assert_eq!(fs::metadata(&fixture.0).unwrap().len(), entry.size);
        let mut existing = HashMap::new();
        existing.insert((entry.path.clone(), entry.modified, entry.size), ());
        let records = scan_sessions_to_records(&[entry], &PricingTable::default(), &existing);
        assert_eq!(
            records.len(),
            1,
            "metadata alone must not skip file contents"
        );
        assert_eq!(records[0].input_tokens, 2_000_000);
    }

    #[test]
    fn scan_rejects_partial_json_and_reprices_unchanged_file() {
        let fixture = Fixture::new(r#"{"model":"gpt-5","usage":{"input_tokens":1000000}}"#);
        let entry = SessionFileEntry {
            path: fixture.0.to_str().unwrap().to_string(),
            tool: "fixture".into(),
            project: "fixture".into(),
            modified: 1,
            size: fs::metadata(&fixture.0).unwrap().len(),
        };
        let first =
            scan_complete_sessions(std::slice::from_ref(&entry), &PricingTable::default()).unwrap();
        let mut changed = PricingTable::default();
        changed.overrides.insert("gpt-5".into(), (10.0, 20.0));
        let second = scan_complete_sessions(std::slice::from_ref(&entry), &changed).unwrap();
        assert_ne!(first[0].cost_total, second[0].cost_total);
        assert_eq!(second[0].cost_total, 10.0);
        fs::write(&fixture.0, "{\"usage\":{\"input_tokens\":1}}\n{broken").unwrap();
        assert!(scan_complete_sessions(&[entry], &changed).is_err());
    }

    #[test]
    fn regression_zero_usage_suppresses_estimation() {
        let fixture = Fixture::new("{\"model\":\"known\",\"usage\":{\"input_tokens\":0,\"output_tokens\":0}}\n{\"content\":\"some text\"}");
        assert!(fixture.extract().is_empty());
        assert!(Fixture::new(r#"{"usage":{"cache_read_input_tokens":"0"}}"#)
            .extract()
            .is_empty());
        assert_eq!(
            Fixture::new(r#"{"usage":{"input_tokens":"invalid"},"content":"preserve fallback"}"#)
                .extract()[0]
                .aggs[0]
                .source,
            "estimated"
        );
    }

    #[test]
    fn regression_invalid_json_does_not_inflate_estimate() {
        let valid = r#"{"content":"a valid message for estimation"}"#;
        let baseline = Fixture::new(valid);
        let mixed = Fixture::new(&format!("{valid}\n{{invalid json with extra characters"));
        assert!(!baseline.extract().is_empty());
        assert_eq!(mixed.extract(), baseline.extract());
        assert!(Fixture::new("{invalid json with extra characters")
            .extract()
            .is_empty());
    }

    #[test]
    fn regression_usage_empty_does_not_overflow() {
        assert!(!Usage {
            input: u64::MAX,
            output: 1,
            ..Usage::default()
        }
        .is_empty());
        assert!(Usage::default().is_empty());
    }

    #[test]
    fn extract_claude_code_format() {
        let json = r#"{
            "type": "assistant",
            "model": "claude-sonnet-4-5",
            "message": {
                "role": "assistant",
                "usage": {
                    "input_tokens": 15000,
                    "output_tokens": 2500
                }
            }
        }"#;
        let v: serde_json::Value = serde_json::from_str(json).unwrap();
        assert_eq!(
            usage_from_value(&v),
            Some(Usage {
                input: 15000,
                output: 2500,
                cache_read: 0,
                cache_creation: 0
            })
        );
    }

    #[test]
    fn extract_openai_format() {
        let json = r#"{
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 50
            }
        }"#;
        let v: serde_json::Value = serde_json::from_str(json).unwrap();
        assert_eq!(
            usage_from_value(&v),
            Some(Usage {
                input: 100,
                output: 50,
                cache_read: 0,
                cache_creation: 0
            })
        );
    }

    #[test]
    fn cache_only_line_is_not_dropped() {
        // 纯缓存写入行：input/output 为 0 但 cache_creation 非 0，这是真实计费事件
        let json =
            r#"{"usage":{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":8000}}"#;
        let v: serde_json::Value = serde_json::from_str(json).unwrap();
        let usage = usage_from_value(&v).expect("应识别为有效 usage");
        assert!(!usage.is_empty());
        assert_eq!(usage.cache_creation, 8000);
    }

    #[test]
    fn measured_usage_splits_by_line_timestamp() {
        let tmp = std::env::temp_dir().join("wb-day-split.jsonl");
        // 真实 Claude Code 格式：model 在 message.model，顶层没有 model
        let lines = [
            r#"{"type":"assistant","timestamp":"2026-01-04T10:00:00Z","message":{"model":"claude-sonnet-4-5","usage":{"input_tokens":100,"output_tokens":10,"cache_read_input_tokens":500,"cache_creation_input_tokens":50}}}"#,
            r#"{"type":"assistant","timestamp":"2026-01-04T23:30:00Z","message":{"model":"claude-sonnet-4-5","usage":{"input_tokens":200,"output_tokens":20}}}"#,
            r#"{"type":"assistant","timestamp":"2026-01-05T01:00:00Z","message":{"model":"claude-sonnet-4-5","usage":{"input_tokens":300,"output_tokens":30,"cache_read_input_tokens":900}}}"#,
        ];
        fs::write(&tmp, lines.join("\n")).unwrap();
        let groups = extract_usage(tmp.to_str().unwrap(), "2026-01-05");
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].model, "claude-sonnet-4-5");
        let aggs = &groups[0].aggs;
        assert_eq!(aggs.len(), 2, "跨两天应拆成两条记录，got {:?}", aggs);
        let total_input: u64 = aggs.iter().map(|a| a.input).sum();
        let total_cache_read: u64 = aggs.iter().map(|a| a.cache_read).sum();
        assert_eq!(total_input, 600);
        assert_eq!(total_cache_read, 1400);
        assert!(aggs.iter().all(|a| a.source == "measured"));
        fs::remove_file(&tmp).ok();
    }

    /// 回归（严重）：真实 Claude Code 把模型放在 message.model，顶层没有 model。
    /// 旧实现只读顶层，导致 model 恒为 unknown → is_priced=false →
    /// 全部记录被标成 zero_pricing，成本面板对真实数据永远显示 $0。
    #[test]
    fn claude_code_nested_model_is_read_and_priced() {
        let tmp = std::env::temp_dir().join("wb-nested-model.jsonl");
        let line = r#"{"type":"assistant","timestamp":"2026-01-06T10:00:00Z","message":{"model":"claude-sonnet-4-5","usage":{"input_tokens":1000000,"output_tokens":0}}}"#;
        fs::write(&tmp, format!("{line}\n")).unwrap();
        let entries = vec![SessionFileEntry {
            path: tmp.to_str().unwrap().to_string(),
            tool: "Claude Code".to_string(),
            project: "p".to_string(),
            modified: 1_767_000_000,
            size: 1,
        }];
        let records = scan_sessions_to_records(&entries, &PricingTable::default(), &HashMap::new());
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].model, "claude-sonnet-4-5");
        assert_eq!(records[0].cost_source, "measured", "真实格式必须能定价");
        // sonnet-4-5 输入 $3/MTok → 100 万 input = $3
        assert!(
            (records[0].cost_total - 3.0).abs() < 0.01,
            "got {}",
            records[0].cost_total
        );
        fs::remove_file(&tmp).ok();
    }

    /// Codex 把模型放在 turn_context.payload.model。
    #[test]
    fn codex_payload_model_is_read() {
        let v: serde_json::Value = serde_json::from_str(
            r#"{"type":"turn_context","payload":{"model":"gpt-5-codex","cwd":"C:/p"}}"#,
        )
        .unwrap();
        assert_eq!(model_from_value(&v).as_deref(), Some("gpt-5-codex"));
    }

    /// <synthetic> 是工具合成消息，不可定价，不能当成该会话的模型。
    #[test]
    fn synthetic_model_is_ignored() {
        let v: serde_json::Value = serde_json::from_str(
            r#"{"type":"assistant","message":{"model":"<synthetic>","usage":{"input_tokens":5}}}"#,
        )
        .unwrap();
        assert_eq!(model_from_value(&v), None);
    }

    /// 同一会话里主对话 opus、子任务 haiku：必须按各自模型的价分别计费，
    /// 不能用一个模型统一套价（那会把 haiku 的用量按 opus 价格算，贵 10 倍以上）。
    #[test]
    fn mixed_models_in_one_file_are_priced_separately() {
        let tmp = std::env::temp_dir().join("wb-mixed-models.jsonl");
        let lines = [
            r#"{"type":"assistant","timestamp":"2026-01-08T10:00:00Z","message":{"model":"claude-opus-4-1","usage":{"input_tokens":1000000,"output_tokens":0}}}"#,
            r#"{"type":"assistant","timestamp":"2026-01-08T11:00:00Z","message":{"model":"claude-haiku-4-5","usage":{"input_tokens":1000000,"output_tokens":0}}}"#,
        ];
        fs::write(&tmp, lines.join("\n")).unwrap();

        let groups = extract_usage(tmp.to_str().unwrap(), "2026-01-08");
        assert_eq!(groups.len(), 2, "应按模型分成两组，got {:?}", groups);
        let models: Vec<&str> = groups.iter().map(|g| g.model.as_str()).collect();
        assert!(models.contains(&"claude-opus-4-1"));
        assert!(models.contains(&"claude-haiku-4-5"));

        let entries = vec![SessionFileEntry {
            path: tmp.to_str().unwrap().to_string(),
            tool: "Claude Code".to_string(),
            project: "p".to_string(),
            modified: 1_767_000_000,
            size: 1,
        }];
        let records = scan_sessions_to_records(&entries, &PricingTable::default(), &HashMap::new());
        assert_eq!(records.len(), 2);
        let opus = records
            .iter()
            .find(|r| r.model == "claude-opus-4-1")
            .unwrap();
        let haiku = records
            .iter()
            .find(|r| r.model == "claude-haiku-4-5")
            .unwrap();
        // opus 输入 $15/MTok，haiku $1/MTok
        assert!(
            (opus.cost_total - 15.0).abs() < 0.01,
            "opus got {}",
            opus.cost_total
        );
        assert!(
            (haiku.cost_total - 1.0).abs() < 0.01,
            "haiku got {}",
            haiku.cost_total
        );
        fs::remove_file(&tmp).ok();
    }

    /// 读不动的文件不应留下带真实 (path, mtime, size) 的记录，
    /// 否则 existing_keys 会永久跳过它，文件后来可读了也不再计费。
    #[test]
    fn unreadable_file_produces_no_records() {
        let groups = extract_usage("C:/definitely/not/a/real/session.jsonl", "2026-01-01");
        assert!(groups.is_empty());

        let entries = vec![SessionFileEntry {
            path: "C:/definitely/not/a/real/session.jsonl".to_string(),
            tool: "Claude Code".to_string(),
            project: "p".to_string(),
            modified: 1_767_000_000,
            size: 10,
        }];
        let records = scan_sessions_to_records(&entries, &PricingTable::default(), &HashMap::new());
        assert!(records.is_empty(), "不可读文件不应产出记录");
    }

    /// 空文件没有可计量内容，不应产出 zero_pricing 记录污染计数。
    #[test]
    fn empty_file_produces_no_records() {
        let tmp = std::env::temp_dir().join("wb-empty.jsonl");
        fs::write(&tmp, "").unwrap();
        assert!(extract_usage(tmp.to_str().unwrap(), "2026-01-01").is_empty());
        fs::remove_file(&tmp).ok();
    }

    #[test]
    fn no_usage_falls_back_to_estimated() {
        let tmp = std::env::temp_dir().join("wb-estimate.jsonl");
        let content = r#"{"content":"This is a test line with about forty characters of text content here."}
{"content":"Another line of similar length and content here."}"#;
        fs::write(&tmp, content).unwrap();
        let groups = extract_usage(tmp.to_str().unwrap(), "2026-01-06");
        let aggs = &groups[0].aggs;
        assert_eq!(aggs.len(), 1);
        assert_eq!(aggs[0].source, "estimated");
        assert!(aggs[0].input + aggs[0].output > 0);
        assert_eq!(aggs[0].day, "2026-01-06");
        fs::remove_file(&tmp).ok();
    }

    #[test]
    fn estimated_rows_are_bucketed_by_line_day_and_stay_stable() {
        // 无 usage 但每行有时间戳：估算应落到各自的那一天，而不是整文件挂到 mtime 日
        let tmp = std::env::temp_dir().join("wb-estimate-perday.jsonl");
        let day_a = r#"{"type":"user","timestamp":"2026-01-03T09:00:00Z","message":{"content":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}"#;
        let day_b = r#"{"type":"user","timestamp":"2026-01-04T09:00:00Z","message":{"content":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}"#;
        fs::write(&tmp, format!("{day_a}\n{day_b}\n")).unwrap();

        let groups = extract_usage(tmp.to_str().unwrap(), "2026-01-09");
        let first_two = &groups[0].aggs;
        assert_eq!(
            first_two.iter().map(|a| a.day.as_str()).collect::<Vec<_>>(),
            vec!["2026-01-03", "2026-01-04"],
            "估算必须按行级日期分桶，不能整组挂到 mtime 日"
        );

        // 追加新一天后，往日桶的 token 数不应变化 —— 趋势图不重写历史
        let day_c = r#"{"type":"user","timestamp":"2026-01-05T09:00:00Z","message":{"content":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}}"#;
        let mut text = fs::read_to_string(&tmp).unwrap();
        text.push_str(day_c);
        text.push('\n');
        fs::write(&tmp, &text).unwrap();

        let groups_after = extract_usage(tmp.to_str().unwrap(), "2026-01-09");
        let after = &groups_after[0].aggs;
        assert_eq!(after.len(), 3);
        for day in ["2026-01-03", "2026-01-04"] {
            let before = first_two.iter().find(|a| a.day == day).unwrap();
            let now = after.iter().find(|a| a.day == day).unwrap();
            assert_eq!(
                (before.input, before.output),
                (now.input, now.output),
                "{day} 的估算量不应随文件追加而变化"
            );
        }
        fs::remove_file(&tmp).ok();
    }

    #[test]
    fn records_use_raw_input_without_cache_subtraction() {
        let tmp = std::env::temp_dir().join("wb-no-subtract.jsonl");
        let line = r#"{"type":"assistant","timestamp":"2026-01-06T10:00:00Z","message":{"model":"claude-sonnet-4-5","usage":{"input_tokens":1000,"output_tokens":500,"cache_read_input_tokens":9000}}}"#;
        fs::write(&tmp, format!("{line}\n")).unwrap();
        let meta = fs::metadata(&tmp).unwrap();
        let modified = meta
            .modified()
            .unwrap()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let entries = vec![SessionFileEntry {
            path: tmp.to_str().unwrap().to_string(),
            tool: "Claude Code".to_string(),
            project: "p".to_string(),
            modified,
            size: meta.len(),
        }];
        let table = PricingTable::default();
        let records = scan_sessions_to_records(&entries, &table, &HashMap::new());
        assert_eq!(records.len(), 1);
        // input 1000 全额计价，不被 cache 9000 吃掉
        assert_eq!(records[0].input_tokens, 1000);
        assert_eq!(records[0].cache_read_tokens, 9000);
        assert!(
            records[0].cost_input > 0.003,
            "got {}",
            records[0].cost_input
        );
        fs::remove_file(&tmp).ok();
    }

    #[test]
    fn unpriced_model_is_flagged_zero_pricing_not_free_money() {
        // 回归：型号推断失败或价格表没有该型号时，不能伪装成「花了 $0.00」的有效记录
        let tmp = std::env::temp_dir().join("wb-unpriced.jsonl");
        let line = r#"{"model":"some-brand-new-model-9000","timestamp":"2026-01-07T10:00:00Z","message":{"usage":{"input_tokens":1000,"output_tokens":500}}}"#;
        fs::write(&tmp, format!("{line}\n")).unwrap();
        let entries = vec![SessionFileEntry {
            path: tmp.to_str().unwrap().to_string(),
            tool: "Claude Code".to_string(),
            project: "p".to_string(),
            modified: 1_767_000_000,
            size: 1,
        }];
        let records = scan_sessions_to_records(&entries, &PricingTable::default(), &HashMap::new());
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].cost_source, "zero_pricing");
        assert_eq!(records[0].cost_total, 0.0);
        // token 数仍然保留，用户能看出「有用量但没定价」而不是凭空没花钱
        assert_eq!(records[0].input_tokens, 1000);
        fs::remove_file(&tmp).ok();
    }

    #[test]
    fn round3_works() {
        assert_eq!(round3(1.23456), 1.235);
        assert_eq!(round3(0.0), 0.0);
    }
}
