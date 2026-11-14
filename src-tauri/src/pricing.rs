//! 模型定价与成本计算
//!
//! 价格单位：USD / 1M tokens。内置主流厂商公开价格快照，可被用户自定义覆盖。
//! 匹配逻辑：先精确匹配 → 再前缀匹配（如 `claude-sonnet-4-5` 匹配 `claude-sonnet-4`）。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// (input_price, output_price)  USD per 1M tokens
pub type PricePair = (f64, f64);

/// 内置价格快照。键为模型名（小写），值为 (input, output) 单价。
/// 参考 TokenLens 的价格表架构，但用更精简的 Rust HashMap 实现。
fn builtin_pricing() -> HashMap<&'static str, PricePair> {
    let mut m = HashMap::new();

    // OpenAI
    m.insert("gpt-5", (1.25, 10.0));
    m.insert("gpt-5-mini", (0.25, 2.0));
    m.insert("gpt-5-nano", (0.05, 0.4));
    m.insert("gpt-4.1", (2.0, 8.0));
    m.insert("gpt-4.1-mini", (0.4, 1.6));
    m.insert("gpt-4.1-nano", (0.1, 0.4));
    m.insert("gpt-4o-mini", (0.15, 0.6));
    m.insert("gpt-4o", (2.5, 10.0));
    m.insert("gpt-4-turbo", (10.0, 30.0));
    m.insert("o4-mini", (1.1, 4.4));
    m.insert("o3-mini", (1.1, 4.4));
    m.insert("o3", (2.0, 8.0));
    m.insert("o1-mini", (1.1, 4.4));
    m.insert("o1", (15.0, 60.0));
    m.insert("text-embedding-3-small", (0.02, 0.0));
    m.insert("text-embedding-3-large", (0.13, 0.0));

    // Anthropic
    m.insert("claude-opus-4-1", (15.0, 75.0));
    m.insert("claude-opus-4-5", (15.0, 75.0));
    m.insert("claude-sonnet-4-5", (3.0, 15.0));
    m.insert("claude-sonnet-4-20250514", (3.0, 15.0));
    m.insert("claude-haiku-4-5", (1.0, 5.0));
    m.insert("claude-3-5-sonnet", (3.0, 15.0));
    m.insert("claude-3-7-sonnet", (3.0, 15.0));
    m.insert("claude-3-5-haiku", (0.8, 4.0));
    m.insert("claude-3-opus", (15.0, 75.0));
    m.insert("claude-3-sonnet", (3.0, 15.0));
    m.insert("claude-3-haiku", (0.25, 1.25));

    // DeepSeek
    m.insert("deepseek-reasoner", (0.55, 2.19));
    m.insert("deepseek-chat", (0.27, 1.10));
    m.insert("deepseek-r1", (0.55, 2.19));
    m.insert("deepseek-v3", (0.27, 1.10));

    // 阿里通义千问
    m.insert("qwen-plus", (0.4, 1.2));
    m.insert("qwen-turbo", (0.1, 0.3));
    m.insert("qwen-max", (0.8, 2.4));
    m.insert("qwen-long", (0.1, 0.3));

    // 字节豆包
    m.insert("doubao-pro-32k", (0.8, 2.0));
    m.insert("doubao-pro-128k", (0.8, 2.0));
    m.insert("doubao-lite-32k", (0.1, 0.3));

    // 智谱 GLM
    m.insert("glm-4-plus", (0.1, 0.1));
    m.insert("glm-4", (0.1, 0.1));
    m.insert("glm-4-air", (0.01, 0.01));
    m.insert("glm-4-flash", (0.0, 0.0));

    // Kimi (Moonshot)
    m.insert("moonshot-v1-8k", (0.1, 0.3));
    m.insert("moonshot-v1-32k", (0.2, 0.6));
    m.insert("moonshot-v1-128k", (0.4, 1.2));

    // OpenRouter 常用
    m.insert("mistral-large", (2.0, 6.0));
    m.insert("mistral-small", (0.2, 0.6));
    m.insert("llama-3.1-405b", (3.5, 3.5));

    // Google
    m.insert("gemini-2.5-pro", (1.25, 10.0));
    m.insert("gemini-2.5-flash", (0.15, 0.6));
    m.insert("gemini-2.0-flash", (0.1, 0.4));

    // xAI
    m.insert("grok-3", (3.0, 15.0));
    m.insert("grok-3-mini", (0.3, 0.5));
    m.insert("grok-2", (2.0, 10.0));

    // 国产其他（键必须小写：lookup 会先把模型名转小写）
    m.insert("ernie-4.0", (0.12, 0.12));
    m.insert("ernie-3.5", (0.12, 0.12));

    m
}

/// 预构建的内置价格表：HashMap + 按长度降序的前缀键。
///
/// 原先每次 `lookup` 都重建一次 HashMap（56 条 insert）再 `collect + sort`
/// 全部键 —— 实测 4.85µs/次。一次成本扫描对每条记录调 2 次 lookup
/// （is_priced + calc_cost），1 万条记录就是近 100ms 的纯开销。
/// 内置表是编译期常量，进程内只需构建一次。
struct BuiltinTable {
    prices: HashMap<&'static str, PricePair>,
    /// 前缀匹配候选，按长度降序（优先最长前缀）
    prefix_keys: Vec<&'static str>,
}

fn builtin_table() -> &'static BuiltinTable {
    use std::sync::OnceLock;
    static TABLE: OnceLock<BuiltinTable> = OnceLock::new();
    TABLE.get_or_init(|| {
        let prices = builtin_pricing();
        let mut prefix_keys: Vec<&'static str> = prices.keys().copied().collect();
        prefix_keys.sort_by_key(|k| std::cmp::Reverse(k.len()));
        BuiltinTable {
            prices,
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
    /// 内置快照的输入/输出单价（USD / 1M tokens），未知型号为 null
    pub builtin_input: Option<f64>,
    pub builtin_output: Option<f64>,
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

impl PricingTable {
    /// 生成 UI 视图：内置型号 + 仅存在于覆盖文件里的型号，按名字排序。
    pub fn rows(&self) -> Vec<PricingRow> {
        let builtin = builtin_table();
        let mut names: Vec<String> = builtin.prices.keys().map(|k| k.to_string()).collect();
        for k in self.overrides.keys() {
            if !builtin.prices.contains_key(k.as_str()) {
                names.push(k.clone());
            }
        }
        names.sort();
        names.dedup();
        names
            .into_iter()
            .map(|model| {
                let b = builtin.prices.get(model.as_str()).copied();
                let o = self.overrides.get(&model).copied();
                PricingRow {
                    builtin_input: b.map(|p| p.0),
                    builtin_output: b.map(|p| p.1),
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
        let builtin = builtin_table();
        // 2) 内置精确
        if let Some(p) = builtin.prices.get(key.as_str()) {
            return *p;
        }
        // 3) 前缀匹配（键已按长度降序预排，最长前缀优先）
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
            cache_read_tokens as f64 / 1_000_000.0 * inp_price * 0.1
                + cache_creation_tokens as f64 / 1_000_000.0 * inp_price * 1.25
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
        assert_eq!(t.lookup("ernie-4.0"), (0.12, 0.12));
        assert_eq!(t.lookup("ERNIE-4.0"), (0.12, 0.12));
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
