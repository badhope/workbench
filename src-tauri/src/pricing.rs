//! 模型定价与成本计算
//!
//! 内部统一用 **USD / 1M tokens** 计算，避免混币。内置价格快照保留原始币种
//! 与来源：人民币官方价按固定汇率换算成 USD，并在 UI 上标注原价、汇率与日期。
//! 匹配逻辑：先精确匹配 → 再前缀匹配（如 `claude-sonnet-4-5` 匹配 `claude-sonnet-4`）。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// (input_price, output_price)  USD per 1M tokens
pub type PricePair = (f64, f64);

/// 内置快照统一换算汇率。人民币官方价按此汇率折算成 USD 后参与计费。
///
/// 这是一个**快照**而不是实时汇率：成本账本要可复现，同一份会话在任何时候
/// 重算都应得到同一个数字。调整汇率必须同时更新 `PRICE_AS_OF` 并重跑测试。
pub const CNY_PER_USD: f64 = 7.20;
pub const PRICE_AS_OF: &str = "2026-11-19";

const SRC_OPENAI: &str = "OpenAI 官方 API 定价（USD）";
const SRC_ANTHROPIC: &str = "Anthropic 官方 API 定价（USD）";
const SRC_DEEPSEEK: &str = "DeepSeek 官方 API 定价（USD）";
const SRC_QWEN: &str = "阿里云百炼国际站（USD）";
const SRC_DOUBAO: &str = "火山方舟（CNY）";
const SRC_GLM: &str = "智谱开放平台（CNY）";
const SRC_KIMI: &str = "Kimi 开放平台（CNY）";
const SRC_OPENROUTER: &str = "OpenRouter 公开价（USD）";
const SRC_GOOGLE: &str = "Google AI 官方定价（USD）";
const SRC_XAI: &str = "xAI 官方定价（USD）";
const SRC_ERNIE: &str = "百度千帆公开价（CNY）";

/// 一条内置价格：原始币种 + 来源 + 快照日期。
#[derive(Clone, Copy, Debug)]
struct BuiltinEntry {
    input: f64,
    output: f64,
    currency: &'static str,
    source: &'static str,
    as_of: &'static str,
}

impl BuiltinEntry {
    fn usd(input: f64, output: f64, source: &'static str) -> Self {
        Self {
            input,
            output,
            currency: "USD",
            source,
            as_of: PRICE_AS_OF,
        }
    }

    fn cny(input: f64, output: f64, source: &'static str) -> Self {
        Self {
            input,
            output,
            currency: "CNY",
            source,
            as_of: PRICE_AS_OF,
        }
    }

    /// 统一折算成 USD。保留 6 位小数：既避免浮点噪声进测试，
    /// 也远高于 1M token 计费所需的精度。
    fn usd_pair(&self) -> PricePair {
        if self.currency == "CNY" {
            (
                round6(self.input / CNY_PER_USD),
                round6(self.output / CNY_PER_USD),
            )
        } else {
            (self.input, self.output)
        }
    }
}

fn round6(value: f64) -> f64 {
    (value * 1_000_000.0).round() / 1_000_000.0
}

/// 内置价格元数据（给 UI 展示原价/币种/来源/日期）。
#[derive(Clone, Debug)]
struct PriceMeta {
    currency: &'static str,
    source: &'static str,
    as_of: &'static str,
    original_input: f64,
    original_output: f64,
}

/// 内置价格快照。键为模型名（小写），值为原始币种 + 来源 + 单价。
///
/// 中国厂商的官方刊例价多为人民币，不能直接塞进 USD 表：
/// 豆包 pro-32k 官方 0.8/2.0 元/百万 tokens，若当 USD 用会高估约 7.2 倍。
/// 这里逐项标注币种，构建时统一换算，UI 同时展示原价与折算价。
fn builtin_pricing() -> HashMap<&'static str, BuiltinEntry> {
    let mut m = HashMap::new();

    // OpenAI
    m.insert("gpt-5", BuiltinEntry::usd(1.25, 10.0, SRC_OPENAI));
    m.insert("gpt-5-mini", BuiltinEntry::usd(0.25, 2.0, SRC_OPENAI));
    m.insert("gpt-5-nano", BuiltinEntry::usd(0.05, 0.4, SRC_OPENAI));
    m.insert("gpt-4.1", BuiltinEntry::usd(2.0, 8.0, SRC_OPENAI));
    m.insert("gpt-4.1-mini", BuiltinEntry::usd(0.4, 1.6, SRC_OPENAI));
    m.insert("gpt-4.1-nano", BuiltinEntry::usd(0.1, 0.4, SRC_OPENAI));
    m.insert("gpt-4o-mini", BuiltinEntry::usd(0.15, 0.6, SRC_OPENAI));
    m.insert("gpt-4o", BuiltinEntry::usd(2.5, 10.0, SRC_OPENAI));
    m.insert("gpt-4-turbo", BuiltinEntry::usd(10.0, 30.0, SRC_OPENAI));
    m.insert("o4-mini", BuiltinEntry::usd(1.1, 4.4, SRC_OPENAI));
    m.insert("o3-mini", BuiltinEntry::usd(1.1, 4.4, SRC_OPENAI));
    m.insert("o3", BuiltinEntry::usd(2.0, 8.0, SRC_OPENAI));
    m.insert("o1-mini", BuiltinEntry::usd(1.1, 4.4, SRC_OPENAI));
    m.insert("o1", BuiltinEntry::usd(15.0, 60.0, SRC_OPENAI));
    m.insert(
        "text-embedding-3-small",
        BuiltinEntry::usd(0.02, 0.0, SRC_OPENAI),
    );
    m.insert(
        "text-embedding-3-large",
        BuiltinEntry::usd(0.13, 0.0, SRC_OPENAI),
    );

    // Anthropic
    m.insert(
        "claude-opus-4-1",
        BuiltinEntry::usd(15.0, 75.0, SRC_ANTHROPIC),
    );
    m.insert(
        "claude-opus-4-5",
        BuiltinEntry::usd(15.0, 75.0, SRC_ANTHROPIC),
    );
    m.insert(
        "claude-sonnet-4-5",
        BuiltinEntry::usd(3.0, 15.0, SRC_ANTHROPIC),
    );
    m.insert(
        "claude-sonnet-4-20250514",
        BuiltinEntry::usd(3.0, 15.0, SRC_ANTHROPIC),
    );
    m.insert(
        "claude-haiku-4-5",
        BuiltinEntry::usd(1.0, 5.0, SRC_ANTHROPIC),
    );
    m.insert(
        "claude-3-5-sonnet",
        BuiltinEntry::usd(3.0, 15.0, SRC_ANTHROPIC),
    );
    m.insert(
        "claude-3-7-sonnet",
        BuiltinEntry::usd(3.0, 15.0, SRC_ANTHROPIC),
    );
    m.insert(
        "claude-3-5-haiku",
        BuiltinEntry::usd(0.8, 4.0, SRC_ANTHROPIC),
    );
    m.insert(
        "claude-3-opus",
        BuiltinEntry::usd(15.0, 75.0, SRC_ANTHROPIC),
    );
    m.insert(
        "claude-3-sonnet",
        BuiltinEntry::usd(3.0, 15.0, SRC_ANTHROPIC),
    );
    m.insert(
        "claude-3-haiku",
        BuiltinEntry::usd(0.25, 1.25, SRC_ANTHROPIC),
    );

    // DeepSeek（官方美元价）
    m.insert(
        "deepseek-reasoner",
        BuiltinEntry::usd(0.55, 2.19, SRC_DEEPSEEK),
    );
    m.insert("deepseek-chat", BuiltinEntry::usd(0.27, 1.10, SRC_DEEPSEEK));
    m.insert("deepseek-r1", BuiltinEntry::usd(0.55, 2.19, SRC_DEEPSEEK));
    m.insert("deepseek-v3", BuiltinEntry::usd(0.27, 1.10, SRC_DEEPSEEK));

    // 阿里通义千问（国际站美元价；国内站人民币价 0.8/2.0 已折算为同一量级）
    m.insert("qwen-plus", BuiltinEntry::usd(0.4, 1.2, SRC_QWEN));
    m.insert("qwen-turbo", BuiltinEntry::usd(0.1, 0.3, SRC_QWEN));
    m.insert("qwen-max", BuiltinEntry::usd(0.8, 2.4, SRC_QWEN));
    m.insert("qwen-long", BuiltinEntry::usd(0.1, 0.3, SRC_QWEN));

    // 字节豆包（官方人民币价）
    m.insert("doubao-pro-32k", BuiltinEntry::cny(0.8, 2.0, SRC_DOUBAO));
    m.insert("doubao-pro-128k", BuiltinEntry::cny(0.8, 2.0, SRC_DOUBAO));
    m.insert("doubao-lite-32k", BuiltinEntry::cny(0.3, 0.6, SRC_DOUBAO));

    // 智谱 GLM（官方人民币价）
    m.insert("glm-4-plus", BuiltinEntry::cny(5.0, 5.0, SRC_GLM));
    m.insert("glm-4", BuiltinEntry::cny(5.0, 5.0, SRC_GLM));
    m.insert("glm-4-air", BuiltinEntry::cny(0.5, 0.5, SRC_GLM));
    m.insert("glm-4-flash", BuiltinEntry::cny(0.0, 0.0, SRC_GLM));

    // Kimi (Moonshot)（官方人民币价）
    m.insert("moonshot-v1-8k", BuiltinEntry::cny(2.0, 10.0, SRC_KIMI));
    m.insert("moonshot-v1-32k", BuiltinEntry::cny(5.0, 20.0, SRC_KIMI));
    m.insert("moonshot-v1-128k", BuiltinEntry::cny(10.0, 30.0, SRC_KIMI));

    // OpenRouter 常用（美元价）
    m.insert("mistral-large", BuiltinEntry::usd(2.0, 6.0, SRC_OPENROUTER));
    m.insert("mistral-small", BuiltinEntry::usd(0.2, 0.6, SRC_OPENROUTER));
    m.insert(
        "llama-3.1-405b",
        BuiltinEntry::usd(3.5, 3.5, SRC_OPENROUTER),
    );

    // Google
    m.insert("gemini-2.5-pro", BuiltinEntry::usd(1.25, 10.0, SRC_GOOGLE));
    m.insert("gemini-2.5-flash", BuiltinEntry::usd(0.15, 0.6, SRC_GOOGLE));
    m.insert("gemini-2.0-flash", BuiltinEntry::usd(0.1, 0.4, SRC_GOOGLE));

    // xAI
    m.insert("grok-3", BuiltinEntry::usd(3.0, 15.0, SRC_XAI));
    m.insert("grok-3-mini", BuiltinEntry::usd(0.3, 0.5, SRC_XAI));
    m.insert("grok-2", BuiltinEntry::usd(2.0, 10.0, SRC_XAI));

    // 百度文心（官方人民币价，ERNIE-4.0 按降价后 4/16）
    m.insert("ernie-4.0", BuiltinEntry::cny(4.0, 16.0, SRC_ERNIE));
    m.insert("ernie-3.5", BuiltinEntry::cny(4.0, 12.0, SRC_ERNIE));

    m
}

/// 预构建的内置价格表：HashMap + 按长度降序的前缀键。
///
/// 原先每次 `lookup` 都重建一次 HashMap（56 条 insert）再 `collect + sort`
/// 全部键 —— 实测 4.85µs/次。一次成本扫描对每条记录调 2 次 lookup
/// （is_priced + calc_cost），1 万条记录就是近 100ms 的纯开销。
/// 内置表是编译期常量，进程内只需构建一次。
struct BuiltinTable {
    /// 已统一折算成 USD 的单价，计费只读这一份。
    prices: HashMap<&'static str, PricePair>,
    /// 原始币种/来源/原价，仅用于 UI 展示与审计。
    meta: HashMap<&'static str, PriceMeta>,
    /// 前缀匹配候选，按长度降序（优先最长前缀）
    prefix_keys: Vec<&'static str>,
}

fn builtin_table() -> &'static BuiltinTable {
    use std::sync::OnceLock;
    static TABLE: OnceLock<BuiltinTable> = OnceLock::new();
    TABLE.get_or_init(|| {
        let entries = builtin_pricing();
        let mut prices = HashMap::with_capacity(entries.len());
        let mut meta = HashMap::with_capacity(entries.len());
        for (key, entry) in &entries {
            prices.insert(*key, entry.usd_pair());
            meta.insert(
                *key,
                PriceMeta {
                    currency: entry.currency,
                    source: entry.source,
                    as_of: entry.as_of,
                    original_input: entry.input,
                    original_output: entry.output,
                },
            );
        }
        let mut prefix_keys: Vec<&'static str> = prices.keys().copied().collect();
        prefix_keys.sort_by_key(|k| std::cmp::Reverse(k.len()));
        BuiltinTable {
            prices,
            meta,
            prefix_keys,
        }
    })
}

/// 价格表：内置快照 + 用户覆盖。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct PricingTable {
    /// 用户自定义覆盖（优先级高于内置）
    pub overrides: HashMap<String, PricePair>,
}

/// 一行可编辑的价格：给 UI 的完整视图（内置值 + 是否有覆盖）。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, ts_rs::TS)]
pub struct PricingRow {
    pub model: String,
    /// 内置快照的输入/输出单价（已折算为 USD / 1M tokens），未知型号为 null
    pub builtin_input: Option<f64>,
    pub builtin_output: Option<f64>,
    /// 内置价的**原始币种**（USD / CNY）。null 表示非内置型号。
    pub builtin_currency: Option<String>,
    /// 内置价的原始输入/输出单价（未折算），用于 UI 显示「¥5.00 → $0.694」
    pub builtin_original_input: Option<f64>,
    pub builtin_original_output: Option<f64>,
    /// 价格来源与快照日期，便于审计
    pub builtin_source: Option<String>,
    pub builtin_as_of: Option<String>,
    /// 当前生效的覆盖值；没有覆盖时为 null
    pub override_input: Option<f64>,
    pub override_output: Option<f64>,
}

/// 导出内置价格表（只读参考，供定价编辑器列出型号）。
pub fn builtin_rows() -> Vec<(&'static str, PricePair)> {
    let mut v: Vec<(&'static str, PricePair)> = builtin_table()
        .prices
        .iter()
        .map(|(k, p)| (*k, *p))
        .collect();
    v.sort_by(|a, b| a.0.cmp(b.0));
    v
}

/// Anthropic / OpenAI / Gemini 的官方标价，来自 `llm-prices`（每行注明价格页与核对日期）。
/// 认得带日期后缀、`anthropic/` 前缀和 Bedrock 形式的型号名；表外型号返回 None，
/// 交给内置快照处理。
fn listed(model: &str) -> Option<&'static llm_prices::Price> {
    llm_prices::lookup(model)
        .filter(|p| matches!(p.provider, "anthropic" | "openai" | "google"))
        .filter(|p| p.input.is_some() && p.output.is_some())
}

impl PricingTable {
    /// 生成 UI 视图：内置型号 + 官方标价型号 + 仅存在于覆盖文件里的型号，按名字排序。
    pub fn rows(&self) -> Vec<PricingRow> {
        let builtin = builtin_table();
        let mut names: Vec<String> = builtin.prices.keys().map(|k| k.to_string()).collect();
        // 把 llm-prices 里当前在售的三家型号也列出来，避免编辑器只看到旧快照、
        // 实际计费却已经按新标价走。
        for p in llm_prices::all()
            .iter()
            .filter(|p| matches!(p.provider, "anthropic" | "openai" | "google"))
            .filter(|p| p.status == "listed" && p.input.is_some() && p.output.is_some())
        {
            names.push(p.model.to_string());
        }
        for k in self.overrides.keys() {
            names.push(k.clone());
        }
        names.sort();
        names.dedup();
        names
            .into_iter()
            .map(|model| {
                let list = listed(&model);
                let b = list
                    .map(|p| (p.input.unwrap_or(0.0), p.output.unwrap_or(0.0)))
                    .or_else(|| builtin.prices.get(model.as_str()).copied());
                let m = if list.is_none() {
                    builtin.meta.get(model.as_str())
                } else {
                    None
                };
                let o = self.overrides.get(&model).copied();
                PricingRow {
                    builtin_input: b.map(|p| p.0),
                    builtin_output: b.map(|p| p.1),
                    builtin_currency: if list.is_some() {
                        Some("USD".to_string())
                    } else {
                        m.map(|x| x.currency.to_string())
                    },
                    builtin_original_input: if let Some(p) = list {
                        p.input
                    } else {
                        m.map(|x| x.original_input)
                    },
                    builtin_original_output: if let Some(p) = list {
                        p.output
                    } else {
                        m.map(|x| x.original_output)
                    },
                    builtin_source: if let Some(p) = list {
                        Some(format!("llm-prices: {}", p.source_url))
                    } else {
                        m.map(|x| x.source.to_string())
                    },
                    builtin_as_of: if let Some(p) = list {
                        Some(p.checked.to_string())
                    } else {
                        m.map(|x| x.as_of.to_string())
                    },
                    override_input: o.map(|p| p.0),
                    override_output: o.map(|p| p.1),
                    model,
                }
            })
            .collect()
    }

    /// 校验一条覆盖：型号必须非空、单价必须是非负有限数、至少一个 > 0。
    /// 返回规范化后的 (model, (input, output))。
    pub fn validate_override(
        model: &str,
        input: f64,
        output: f64,
    ) -> Result<(String, PricePair), String> {
        let key = model.trim().to_ascii_lowercase();
        if key.is_empty() {
            return Err("模型名不能为空".to_string());
        }
        if key.len() > 120 {
            return Err("模型名过长（上限 120 字符）".to_string());
        }
        if !input.is_finite() || !output.is_finite() || input < 0.0 || output < 0.0 {
            return Err("单价必须是有限的非负数".to_string());
        }
        if input == 0.0 && output == 0.0 {
            return Err("输入与输出单价不能同时为 0（等于把该型号标成未定价）".to_string());
        }
        // 上限 10000 USD / 1M tokens：任何真实模型都远低于此，
        // 超过它几乎必然是「把每 token 价按每 1M 填」这类单位错误。
        if input > 10_000.0 || output > 10_000.0 {
            return Err(
                "单价过高（上限 10000 USD / 1M tokens），请检查是否填成了每 token 价".to_string(),
            );
        }
        Ok((key, (input, output)))
    }
}

impl PricingTable {
    /// 查找模型的单价（精确匹配 → 前缀匹配 → 未知模型 = 0）
    pub fn lookup(&self, model: &str) -> PricePair {
        let key = model.to_ascii_lowercase();
        // 1) 用户覆盖
        if let Some(p) = self.overrides.get(&key) {
            return *p;
        }
        // 2) 官方标价（llm-prices）
        if let Some(p) = listed(&key) {
            return (p.input.unwrap_or(0.0), p.output.unwrap_or(0.0));
        }
        let builtin = builtin_table();
        // 3) 内置精确
        if let Some(p) = builtin.prices.get(key.as_str()) {
            return *p;
        }
        // 4) 前缀匹配（键已按长度降序预排，最长前缀优先）
        for k in &builtin.prefix_keys {
            if key.starts_with(k) {
                return builtin.prices[k];
            }
        }
        (0.0, 0.0)
    }

    /// 计算成本（input + output tokens 分开计价，各自按 1M 归一）
    ///
    /// 语义约定：`input_tokens` 为**不含缓存**的常规输入（Anthropic API 的
    /// `input_tokens` 本身就不含 cache_read/cache_creation，三者互斥）。
    /// cache_read 按 0.1x、cache_creation 按 1.25x 计价。
    /// 非 Anthropic 模型没有独立的缓存 token 字段（OpenAI 的 cached_tokens 已含在
    /// prompt_tokens 里），缓存分量按 0 处理，避免重复计费。
    pub fn calc_cost(
        &self,
        model: &str,
        input_tokens: u64,
        output_tokens: u64,
        cache_read_tokens: u64,
        cache_creation_tokens: u64,
    ) -> (f64, f64, f64) {
        let (inp_price, out_price) = self.lookup(model);
        let is_anthropic = model.to_ascii_lowercase().starts_with("claude-");
        let inp_cost = input_tokens as f64 / 1_000_000.0 * inp_price;
        let out_cost = output_tokens as f64 / 1_000_000.0 * out_price;
        let cache_cost = if is_anthropic {
            // 官方缓存价优先（Opus 5.5 缓存读是 0.05x，Fable 5.1+ 是 0.025x），
            // 用户覆盖了单价或表外型号时按 0.1x / 1.25x 估算。
            let listed =
                listed(model).filter(|_| !self.overrides.contains_key(&model.to_ascii_lowercase()));
            let read = listed.and_then(|p| p.cache_read).unwrap_or(inp_price * 0.1);
            let write = listed
                .and_then(|p| p.cache_write("5m"))
                .unwrap_or(inp_price * 1.25);
            cache_read_tokens as f64 / 1_000_000.0 * read
                + cache_creation_tokens as f64 / 1_000_000.0 * write
        } else {
            0.0
        };
        let total = inp_cost + out_cost + cache_cost;
        (inp_cost + cache_cost, out_cost, total)
    }

    /// 该型号是否**已知**（表里有键，含 0 价免费模型）。
    ///
    /// 不能只看「价格 > 0」：`glm-4-flash` 这类免费模型内置价就是 (0, 0)，
    /// 用价格判断会把它们归进「未定价」，界面上标成数据质量缺陷。
    /// 「已知」和「非零」是两件事，这里按前者判定。
    pub fn is_priced(&self, model: &str) -> bool {
        let key = model.to_ascii_lowercase();
        if self.overrides.contains_key(&key) {
            return true;
        }
        if listed(&key).is_some() {
            return true;
        }
        let builtin = builtin_table();
        if builtin.prices.contains_key(key.as_str()) {
            return true;
        }
        // 前缀/包含匹配（如带日期后缀的模型名），与 lookup 的兜底一致
        builtin
            .prices
            .keys()
            .any(|k| key.starts_with(k) || key.contains(k))
    }
}

// 模型名推断已移到 session_meter::model_from_value：
// 真实 Claude Code 把模型放在 message.model、Codex 放在 turn_context.payload.model，
// 原先这里的「只读顶层 model」实现在真实数据上永远返回 unknown，
// 导致所有记录被判成 zero_pricing。保留两份实现只会再次漂移。

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_exact_and_prefix() {
        let t = PricingTable::default();
        // 精确匹配
        assert_eq!(t.lookup("gpt-4o"), (2.5, 10.0));
        // 前缀匹配
        let p = t.lookup("claude-sonnet-4-5-xxxxxx");
        assert_eq!(p, (3.0, 15.0));
        // 未知
        assert_eq!(t.lookup("totally-unknown-model"), (0.0, 0.0));
    }

    #[test]
    fn overrides_take_priority() {
        let mut t = PricingTable::default();
        t.overrides.insert("gpt-4o".to_string(), (5.0, 20.0));
        assert_eq!(t.lookup("gpt-4o"), (5.0, 20.0));
    }

    #[test]
    fn calc_cost_basic() {
        let t = PricingTable::default();
        let (inp, out, total) = t.calc_cost("gpt-4o", 1_000_000, 500_000, 0, 0);
        assert!((inp - 2.5).abs() < 0.001);
        assert!((out - 5.0).abs() < 0.001);
        assert!((total - 7.5).abs() < 0.001);
    }

    #[test]
    fn calc_cost_zero_for_unknown() {
        let t = PricingTable::default();
        let (_, _, total) = t.calc_cost("unknown-model-xyz", 1_000_000, 1_000_000, 0, 0);
        assert_eq!(total, 0.0);
    }

    #[test]
    fn calc_cost_anthropic_cache_pricing() {
        // claude-sonnet-4-5: input $3/MTok, output $15/MTok
        // Anthropic 语义：input_tokens 不含缓存，cache_read 0.1x = $0.3/MTok,
        // cache_creation 1.25x = $3.75/MTok，三部分相加。
        let t = PricingTable::default();
        let (inp, out, total) = t.calc_cost(
            "claude-sonnet-4-5",
            1_000_000, // 常规输入（不含缓存）
            200_000,   // 输出
            100_000,   // cache_read
            50_000,    // cache_creation
        );
        // inp = 1.0*3 + 0.1*0.3 + 0.05*3.75 = 3 + 0.03 + 0.1875 = 3.2175
        assert!((inp - 3.2175).abs() < 0.01, "inp got {}", inp);
        // out_cost: 0.2 * 15 = 3.0
        assert!((out - 3.0).abs() < 0.01);
        assert!((total - 6.2175).abs() < 0.01, "total got {}", total);
    }

    #[test]
    fn current_models_use_the_official_list_price() {
        // 以前：claude-opus-4-6 及 5.x 全系没有匹配的键，成本记为 $0；
        // claude-opus-4-5 按 Opus 4.1 的 $15/$75 计（实际 $5/$25）。
        let t = PricingTable::default();
        assert_eq!(t.lookup("claude-opus-4-5"), (5.0, 25.0));
        assert_eq!(t.lookup("claude-opus-4-6"), (5.0, 25.0));
        assert_eq!(t.lookup("claude-opus-5-5"), (4.0, 20.0));
        assert_eq!(t.lookup("claude-sonnet-5-5-20990101"), (2.0, 10.0));
        assert_eq!(t.lookup("claude-haiku-5-5"), (0.1, 0.5));
        assert_eq!(t.lookup("gpt-5.5"), (5.0, 30.0));
        assert!(t.is_priced("claude-opus-4-7"));
        // Opus 5.5 缓存读 $0.20（0.05x）、5 分钟缓存写 $5
        let (inp, _, _) = t.calc_cost("claude-opus-5-5", 0, 0, 1_000_000, 1_000_000);
        assert!((inp - 5.2).abs() < 1e-9, "inp got {}", inp);
    }

    #[test]
    fn non_anthropic_cache_not_double_counted() {
        // gpt-4o：没有独立 cache 字段，传入的 cache 量不加价（已含在 input 语义外，按 0 处理）
        let t = PricingTable::default();
        let (inp, _, total) = t.calc_cost("gpt-4o", 500_000, 0, 1_000_000, 0);
        assert!((inp - 1.25).abs() < 0.001);
        assert!((total - 1.25).abs() < 0.001);
    }

    #[test]
    fn ernie_keys_match_lowercase_lookup() {
        let t = PricingTable::default();
        let expected = (round6(4.0 / CNY_PER_USD), round6(16.0 / CNY_PER_USD));
        assert_eq!(t.lookup("ernie-4.0"), expected);
        assert_eq!(t.lookup("ERNIE-4.0"), expected);
    }

    #[test]
    fn cny_prices_are_converted_at_documented_rate() {
        let t = PricingTable::default();
        for (model, cny_input, cny_output) in [
            ("doubao-pro-32k", 0.8, 2.0),
            ("glm-4-plus", 5.0, 5.0),
            ("moonshot-v1-8k", 2.0, 10.0),
            ("ernie-4.0", 4.0, 16.0),
        ] {
            let (input, output) = t.lookup(model);
            assert!(
                (input - cny_input / CNY_PER_USD).abs() < 1e-6,
                "{model} 输入价未按汇率折算: got {input}"
            );
            assert!(
                (output - cny_output / CNY_PER_USD).abs() < 1e-6,
                "{model} 输出价未按汇率折算: got {output}"
            );
        }
    }

    #[test]
    fn builtin_rows_expose_currency_source_and_original_price() {
        let rows = PricingTable::default().rows();

        let doubao = rows.iter().find(|r| r.model == "doubao-pro-32k").unwrap();
        assert_eq!(doubao.builtin_currency.as_deref(), Some("CNY"));
        assert_eq!(doubao.builtin_original_input, Some(0.8));
        assert_eq!(doubao.builtin_original_output, Some(2.0));
        assert!((doubao.builtin_input.unwrap() - 0.8 / CNY_PER_USD).abs() < 1e-6);
        assert!(doubao
            .builtin_source
            .as_deref()
            .unwrap_or_default()
            .contains("火山"));
        assert_eq!(doubao.builtin_as_of.as_deref(), Some(PRICE_AS_OF));

        let gpt = rows.iter().find(|r| r.model == "gpt-4o").unwrap();
        assert_eq!(gpt.builtin_currency.as_deref(), Some("USD"));
        assert_eq!(gpt.builtin_input, Some(2.5));
        assert_eq!(gpt.builtin_original_input, Some(2.5));

        // UI 不能继续展示旧快照的 $15/$75，否则会和实际计费对不上。
        let opus = rows.iter().find(|r| r.model == "claude-opus-4-5").unwrap();
        assert_eq!(opus.builtin_input, Some(5.0));
        assert_eq!(opus.builtin_output, Some(25.0));
        assert!(opus
            .builtin_source
            .as_deref()
            .unwrap_or_default()
            .contains("llm-prices"));

        // 新模型也要能在编辑器里看到，而不是只能靠手填覆盖。
        let opus47 = rows.iter().find(|r| r.model == "claude-opus-4-7").unwrap();
        assert_eq!(opus47.builtin_input, Some(5.0));
        assert_eq!(opus47.builtin_output, Some(25.0));
    }

    #[test]
    fn rows_include_builtin_and_override_only_models() {
        let mut t = PricingTable::default();
        t.overrides.insert("my-private-model".into(), (1.5, 6.0));
        t.overrides.insert("gpt-4o".into(), (9.0, 30.0));
        let rows = t.rows();

        let gpt = rows.iter().find(|r| r.model == "gpt-4o").unwrap();
        assert_eq!(gpt.builtin_input, Some(2.5), "内置价必须仍然可见");
        assert_eq!(gpt.override_input, Some(9.0), "覆盖价要标出来");

        let mine = rows.iter().find(|r| r.model == "my-private-model").unwrap();
        assert_eq!(mine.builtin_input, None, "非内置型号没有内置价");
        assert_eq!(mine.override_output, Some(6.0));

        // 排序稳定，且没有重复
        let mut sorted = rows.clone();
        sorted.sort_by(|a, b| a.model.cmp(&b.model));
        assert_eq!(
            rows.iter().map(|r| &r.model).collect::<Vec<_>>(),
            sorted.iter().map(|r| &r.model).collect::<Vec<_>>()
        );
    }

    #[test]
    fn validate_override_rejects_bad_input() {
        // 空名、负价、NaN、全 0、过高单价全部拒绝
        assert!(PricingTable::validate_override("", 1.0, 1.0).is_err());
        assert!(PricingTable::validate_override("  ", 1.0, 1.0).is_err());
        assert!(PricingTable::validate_override("m", -1.0, 1.0).is_err());
        assert!(PricingTable::validate_override("m", 1.0, -0.5).is_err());
        assert!(PricingTable::validate_override("m", f64::NAN, 1.0).is_err());
        assert!(PricingTable::validate_override("m", f64::INFINITY, 1.0).is_err());
        assert!(PricingTable::validate_override("m", 0.0, 0.0).is_err());
        assert!(PricingTable::validate_override("m", 20_000.0, 1.0).is_err());
    }

    #[test]
    fn validate_override_normalizes_model_name() {
        let (key, pair) = PricingTable::validate_override("  My-Model  ", 1.0, 2.0).unwrap();
        assert_eq!(
            key, "my-model",
            "型号名统一小写并去空白，否则大小写会存成两条"
        );
        assert_eq!(pair, (1.0, 2.0));
    }

    #[test]
    fn override_with_zero_output_price_is_allowed() {
        // embedding 类模型 output 就是 0，不能被上面「全 0」规则误杀
        let (_, pair) = PricingTable::validate_override("embed-x", 0.02, 0.0).unwrap();
        assert_eq!(pair, (0.02, 0.0));
    }

    #[test]
    fn unknown_model_is_never_priced() {
        // 关键回归：宁可 unknown（走 zero_pricing，UI 显示「未定价」），
        // 也不能把 haiku/gpt 会话编成 sonnet 计费。
        assert!(!PricingTable::default().is_priced("unknown"));
        assert!(PricingTable::default().is_priced("claude-sonnet-4-5"));
    }
}
