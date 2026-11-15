/**
 * 命令面板的模糊匹配。
 *
 * 不用第三方模糊库：约束只有三条——顺序匹配、前缀/词首优先、大小写无关。
 * 一个几十行的打分函数比引入 10 KB 依赖更容易解释，也能单测每个分支。
 * 返回 0 表示不匹配（调用方据此过滤），正数越大越靠前。
 *
 * 打分分档而不是累加：匹配质量必须**跨档压制**，档内才比细项。
 * 反例（曾经的真实 bug）：搜 `cost`，11 个 `conhost.exe` 靠「c-o-s-t 散落
 * 出现」累加出 54 分，而成本账本页只在 keywords 里有 `costs`，乘 0.8 权重
 * 后 47 分——真正想跳的页面被进程挤出了结果列表。散字母匹配必须永远排在
 * 连续/前缀匹配之后。
 */
export interface CommandItem {
  id: string;
  label: string;
  keywords?: string;
}

/** 匹配档位：数值差距足够大，保证低档永远压不过高档。 */
const TIER = {
  exact: 1000,
  prefix: 900,
  wordStart: 800,
  contains: 700,
  /** 子序列（散落匹配）占 0..400，永远低于 contains */
  subsequence: 400,
} as const;

const WORD_SEP = /[\s\-_/.:·|,()[\]{}]/;

export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const t = text.toLowerCase();
  // 档内用「目标越短越接近整词」做细排，最多 20 分，不会跨档
  const lengthBonus = Math.max(0, 24 - t.length) / 24;

  if (t === q) return TIER.exact + lengthBonus;
  if (t.startsWith(q)) return TIER.prefix + lengthBonus;

  // 词首匹配：命中位置前一个字符是分隔符
  const boundary = t.indexOf(q);
  let wordStart = -1;
  for (let at = boundary; at >= 0; at = t.indexOf(q, at + 1)) {
    if (at === 0 || WORD_SEP.test(t[at - 1])) {
      wordStart = at;
      break;
    }
  }
  if (wordStart >= 0) return TIER.wordStart + lengthBonus;
  if (boundary >= 0) return TIER.contains + lengthBonus;

  // 子序列：按顺序逐字符出现即算匹配，分数落在 (0, subsequence) 开区间，
  // 连续命中与词首命中给额外加成，让「ps」这类缩写仍然可用。
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    const at = t.indexOf(ch, ti);
    if (at < 0) return 0;
    score += 1;
    if (at === 0 || WORD_SEP.test(t[at - 1])) score += 20;
    if (at === prev + 1) score += 5;
    prev = at;
    ti = at + 1;
  }
  // 归一化到档内：最长可能分数约为 q.length * 26，压到 0..TIER.subsequence
  const maxRaw = q.length * 26;
  return (score / maxRaw) * TIER.subsequence;
}

export function rankCommands<T extends CommandItem>(
  items: T[],
  query: string,
  limit = 8
): T[] {
  if (!query.trim()) return items.slice(0, limit);
  return items
    .map((item) => ({
      item,
      // keywords 是补充信息（路径、命令行），命中质量打折但不降档：
      // 打 0.8 后前缀 720 仍高于 label 的散字母匹配（≤400）。
      score: Math.max(
        fuzzyScore(query, item.label),
        fuzzyScore(query, item.keywords ?? "") * 0.8
      ),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.item);
}
