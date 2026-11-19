import type { KnowledgeDoc, KnowledgeHit, KnowledgeStatus } from "../types";
import { getLang } from "./i18n";

type DemoLang = "en" | "zh" | "ja";

interface DemoNote {
  path: string;
  project_id?: string;
  tags: string[];
  title: Record<DemoLang, string>;
  snippet: Record<DemoLang, string>;
  body: Record<DemoLang, string>;
}

/**
 * 纯静态预览的知识库样例。
 *
 * 桌面端/HTTP 后端始终走真实文件；这里只让没有后端的浏览器预览不显示
 * HTTP 404，演示数据的边界和日志页一样明确。正文仍放在 Markdown 字符串里，
 * 不复制进任何数据库。
 */
const NOTES: DemoNote[] = [
  {
    path: "~/workbench/notes/architecture.md",
    project_id: "demo-p1",
    tags: ["architecture", "rust"],
    title: {
      en: "Workbench architecture",
      zh: "工作台架构",
      ja: "ワークベンチ構成",
    },
    snippet: {
      en: "Frontend is the view layer; Rust owns files, tasks and local knowledge.",
      zh: "前端只做视图层；Rust 负责文件、任务与本地知识索引。",
      ja: "フロントは表示層、Rust がファイル・タスク・ローカル知識を担当。",
    },
    body: {
      en: "# Workbench architecture\n\n- React renders the workspace and keeps interaction state.\n- Rust owns the data directory and atomic writes.\n- MCP exposes read-only context plus controlled writes.\n\nKnowledge stays in user Markdown; SQLite stores only the FTS index.",
      zh: "# 工作台架构\n\n- React 负责工作台界面与交互状态。\n- Rust 负责数据目录和原子写入。\n- MCP 暴露只读上下文，写入默认关闭。\n\n知识正文保留在用户的 Markdown 里，SQLite 只存 FTS 索引。",
      ja: "# ワークベンチ構成\n\n- React は画面と操作状態を担当。\n- Rust はデータディレクトリとアトミック書き込みを担当。\n- MCP は読み取り上下文と制御付き書き込みを提供。\n\n知識本文はユーザーの Markdown に残し、SQLite は FTS 索引だけを持つ。",
    },
  },
  {
    path: "~/workbench/notes/today-flow.md",
    project_id: "demo-p1",
    tags: ["workflow", "today"],
    title: {
      en: "Today flow",
      zh: "今天的工作流",
      ja: "今日のワークフロー",
    },
    snippet: {
      en: "Capture first, decide later: inbox → focus → review.",
      zh: "先记录后决定：收件箱 → 聚焦 → 回顾。",
      ja: "まず記録、後で判断：受信箱 → 集中 → 振り返り。",
    },
    body: {
      en: "# Today flow\n\n1. Capture a thought into the inbox.\n2. Pick one active task for the current project.\n3. Review completed work at the end of the day.\n\nThe dashboard should show state, not hide it behind another menu.",
      zh: "# 今天的工作流\n\n1. 先把想法放进收件箱。\n2. 为当前项目选一个进行中的任务。\n3. 结束时回顾已完成的工作。\n\n首页应该直接显示状态，而不是再藏进一层菜单。",
      ja: "# 今日のワークフロー\n\n1. 思いつきを受信箱へ。\n2. 現在のプロジェクトから進行中タスクを1つ選ぶ。\n3. 終了時に完了した作業を振り返る。\n\nホームは状態を隠さず直接表示する。",
    },
  },
  {
    path: "~/workbench/notes/mcp-boundary.md",
    project_id: "demo-p2",
    tags: ["mcp", "security"],
    title: {
      en: "MCP write boundary",
      zh: "MCP 写入边界",
      ja: "MCP 書き込み境界",
    },
    snippet: {
      en: "Writes are off by default; task writes are audited and undoable.",
      zh: "写入默认关闭；任务写入有审计并且可撤销。",
      ja: "書き込みは既定で無効、タスク書き込みは監査・取消可能。",
    },
    body: {
      en: "# MCP write boundary\n\nRead tools are always available. Write tools require `allow_writes`, share the same data lock as the UI, and append an audit record before returning.\n\nUndo is refused when the target changed after the write, so a later manual edit is never clobbered.",
      zh: "# MCP 写入边界\n\n只读工具始终可用。写入工具需要 `allow_writes`，与界面共用同一把数据锁，并在返回前写审计记录。\n\n如果目标在写入后又被手改，撤销会被拒绝，避免覆盖用户后续修改。",
      ja: "# MCP 書き込み境界\n\n読み取りツールは常に利用可能。書き込みには `allow_writes` が必要で、UI と同じデータロックを共有し、返す前に監査記録を残す。\n\n書き込み後に手動編集された場合、取消は拒否され上書きしない。",
    },
  },
  {
    path: "~/workbench/notes/cost-metering.md",
    project_id: "demo-p2",
    tags: ["cost", "ai"],
    title: {
      en: "Cost metering",
      zh: "成本计量",
      ja: "コスト計測",
    },
    snippet: {
      en: "Every model call becomes a ledger row, not an estimate.",
      zh: "每次模型调用落成账本行，不靠估算。",
      ja: "モデル呼び出しを台帳行として記録し、推測しない。",
    },
    body: {
      en: "# Cost metering\n\nUsage comes from local session files and provider records. Pricing overrides are explicit and the UI labels the source.\n\nThe daily card should show today, budget and the threshold marker together so overspend is visible before opening the ledger.",
      zh: "# 成本计量\n\n用量来自本地会话文件与服务商记录，定价覆盖必须显式配置，界面标注来源。\n\n今日卡片应同时显示今日、预算与阈值标记，让超支在打开账本前就能看到。",
      ja: "# コスト計測\n\n使用量はローカルセッションとプロバイダー記録から取得。価格上書きは明示し、UI に来源を表示する。\n\n今日カードは今日・予算・閾値を同時に出し、台帳を開く前に超過が見えるようにする。",
    },
  },
  {
    path: "~/workbench/notes/design-tokens.md",
    project_id: "demo-p1",
    tags: ["design", "ui"],
    title: {
      en: "Design tokens",
      zh: "设计令牌",
      ja: "デザイントークン",
    },
    snippet: {
      en: "One token set drives themes, charts and motion.",
      zh: "一套令牌同时驱动主题、图表与动效。",
      ja: "1つのトークンセットがテーマ・チャート・動きを駆動。",
    },
    body: {
      en: "# Design tokens\n\nThemes are inline CSS variables, so user themes are data rather than a hard-coded enum. Charts receive real hex values from the same theme registry.\n\nMotion has off / standard / rich levels, and charts disable animation when motion is off.",
      zh: "# 设计令牌\n\n主题是内联 CSS 变量，用户主题是数据而不是硬编码枚举。图表从同一份主题注册表拿真实色值。\n\n动效有 off / standard / rich 三档，关闭动效时图表也停止动画。",
      ja: "# デザイントークン\n\nテーマはインライン CSS 変数で、ユーザーテーマはハードコードではなくデータ。チャートも同じ登録から実色を受け取る。\n\n動きは off / standard / rich の3段階で、off ではチャートも停止する。",
    },
  },
  {
    path: "~/workbench/notes/review-rhythm.md",
    project_id: "demo-p2",
    tags: ["review", "workflow"],
    title: {
      en: "Review rhythm",
      zh: "回顾节奏",
      ja: "振り返りのリズム",
    },
    snippet: {
      en: "Weekly review is a state readout, not a second dashboard.",
      zh: "周回顾是状态读数，不是第二套仪表盘。",
      ja: "週次振り返りは状態の読み出しで、別のダッシュボードではない。",
    },
    body: {
      en: "# Review rhythm\n\nReview shows completion, overdue work and the 14-day flow. It should reuse the same task data and status colors as Today and Tasks.\n\nIf a number moves, the reader should be able to see which state it came from.",
      zh: "# 回顾节奏\n\n回顾展示完成率、逾期任务与 14 天流动，复用 Today 与 Tasks 的同一份任务数据和状态颜色。\n\n数字变化时，读者应该能看出它来自哪个状态。",
      ja: "# 振り返りのリズム\n\n振り返りは完了率・期限超過・14日間の流れを表示し、Today と Tasks と同じタスクデータ・状態色を再利用する。\n\n数字が動いたとき、どの状態から来たか分かるべき。",
    },
  },
];

const lang = (): DemoLang => {
  const current = getLang();
  return current === "zh" || current === "ja" ? current : "en";
};

export function demoKnowledgeStatus(): KnowledgeStatus {
  return {
    sources: [{ path: "~/workbench/notes", name: "notes" }],
    doc_count: NOTES.length,
    last_indexed_at: Math.floor(Date.now() / 1000),
    db_path: "demo://knowledge.db",
  };
}

export function demoKnowledgeSearch(query: string, limit = 20): KnowledgeHit[] {
  const q = query.trim().toLowerCase();
  const locale = lang();
  return NOTES.filter((note) => {
    if (!q) return true;
    return [
      note.title[locale],
      note.snippet[locale],
      note.body[locale],
      note.tags.join(" "),
    ]
      .join(" ")
      .toLowerCase()
      .includes(q);
  })
    .slice(0, limit)
    .map((note) => ({
      path: note.path,
      title: note.title[locale],
      project_id: note.project_id,
      tags: note.tags,
      snippet: note.snippet[locale],
    }));
}

export function demoKnowledgeRead(path: string): KnowledgeDoc {
  const note = NOTES.find((item) => item.path === path);
  if (!note) throw new Error(`demo note not found: ${path}`);
  const locale = lang();
  return {
    path: note.path,
    title: note.title[locale],
    body: note.body[locale],
    project_id: note.project_id,
    tags: note.tags,
    mtime: Math.floor(Date.now() / 1000),
  };
}
