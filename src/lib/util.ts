import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/en";
import "dayjs/locale/zh-cn";
import "dayjs/locale/ja";
import { getLang, localeFor, t, type Lang } from "./i18n";

dayjs.extend(relativeTime);

/** 界面语言 → dayjs 已注册 locale 名（en / zh-cn / ja） */
function dayjsLocale(l: Lang): string {
  return l === "zh" ? "zh-cn" : l;
}

const NUMBER_FORMATS = new Map<string, Intl.NumberFormat>();
const DATE_TIME_FORMATS = new Map<Lang, Intl.DateTimeFormat>();
const COMPACT_TIME_FORMATS = new Map<Lang, Intl.DateTimeFormat>();

/** 数字格式器按「语言 + 小数位」缓存；表格里每次渲染都 new 会明显变慢。 */
function numberFormat(lang: Lang, digits: number): Intl.NumberFormat {
  const key = `${lang}:${digits}`;
  let fmt = NUMBER_FORMATS.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(localeFor(lang), {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    NUMBER_FORMATS.set(key, fmt);
  }
  return fmt;
}

function dateTimeFormat(lang: Lang): Intl.DateTimeFormat {
  let fmt = DATE_TIME_FORMATS.get(lang);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(localeFor(lang), {
      dateStyle: "medium",
      timeStyle: "short",
    });
    DATE_TIME_FORMATS.set(lang, fmt);
  }
  return fmt;
}

/**
 * 字节 → 可读单位。数字走 `Intl.NumberFormat`，小数点/分组符跟随界面语言；
 * 单位本身保持 B/KB/MB/GB/TB（跨语言通用，翻译反而会让用户对不上系统盘）。
 */
export function formatBytes(bytes: number, lang: Lang = getLang()): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  const digits = v >= 100 || i === 0 ? 0 : 1;
  return `${numberFormat(lang, digits).format(v)} ${units[i]}`;
}

/** 毫秒时间戳 / ISO 字符串 / Date → 本地化日期时间（如 “2026年11月20日 14:30”）。 */
export function formatDateTime(
  value: number | string | Date,
  lang: Lang = getLang()
): string {
  if (value === 0 || value === "") return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return dateTimeFormat(lang).format(date);
}

export function formatCpu(cpu: number): string {
  return `${cpu.toFixed(1)}%`;
}

/** Unix 秒 → 友好的相对时间（如 "3 minutes ago"）；跟随当前界面语言。 */
export function fromNow(unixSecs: number): string {
  if (!unixSecs) return "-";
  return dayjs.unix(unixSecs).locale(dayjsLocale(getLang())).fromNow();
}

export function formatTime(ms: number, lang: Lang = getLang()): string {
  if (!ms) return "-";
  // 顶部“数据更新于”保持紧凑：本地化的月日 + 24 小时制时分。
  let fmt = COMPACT_TIME_FORMATS.get(lang);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(localeFor(lang), {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    COMPACT_TIME_FORMATS.set(lang, fmt);
  }
  return fmt.format(new Date(ms));
}

/**
 * 到期状态 → 展示文案 + 直接可用的 Badge 色调。
 * 原先返回业务态 "normal"/"muted"，每个调用方再各写一次到视觉色调的映射，
 * 现在收敛成一份（"正常"用 dim 呈现，不额外造一个语义层）。
 *
 * 日期比较按「本地日历日」而非时长：`diff(now, "day")` 会把今天 23:59
 * 与现在 00:01 算成 0 天、却把「今天」在 UTC 偏移下算成前一天。这里把两边
 * 都归一到本地 00:00 再比，跨时区/跨夏令时都稳定。
 */
export function dueLabel(due: string | null): {
  text: string;
  tone: "warn" | "danger" | "dim";
} {
  if (!due) return { text: t("util.noDueDate"), tone: "dim" };
  // dayjs 解析 "YYYY-MM-DD" 得到的就是本地当天 00:00
  const d = dayjs(due);
  if (!d.isValid()) return { text: due, tone: "dim" };
  const days = d.startOf("day").diff(dayjs().startOf("day"), "day");
  if (days < 0)
    return { text: t("util.overdue", { date: d.format("MM-DD") }), tone: "danger" };
  if (days === 0) return { text: t("util.today"), tone: "warn" };
  if (days <= 3) return { text: t("util.withinDays", { days }), tone: "warn" };
  return { text: d.format("MM-DD"), tone: "dim" };
}

export function shortPath(p: string | null | undefined, max = 60): string {
  if (!p) return "-";
  return p.length > max ? `…${p.slice(-max)}` : p;
}

/** 秒数 → 人性化运行时间（跟随当前界面语言） */
export function formatUptime(secs: number): string {
  if (!secs) return "-";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(t("util.uptimeDay", { n: d }));
  if (h) parts.push(t("util.uptimeHour", { n: h }));
  if (m && d === 0) parts.push(t("util.uptimeMinute", { n: m }));
  return parts.join(" ") || t("util.uptimeShort");
}

/** 秒 → 可读时长（2小时15分 / 45分钟 / 30秒 → 三语紧凑写法） */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return t("util.durShort");
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    let out = t("util.durHour", { n: h });
    if (m > 0) out += t("util.durMinShort", { n: m });
    return out;
  }
  if (m > 0) {
    let out = t("util.durMinFull", { n: m });
    if (s > 0) out += t("util.durSecond", { n: s });
    return out;
  }
  return t("util.durSecond", { n: s });
}

/** 美元格式化：< $0.01 显示 4 位，否则 2 位 */
export function formatUsd(n: number): string {
  if (n <= 0 || !isFinite(n)) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

/** Token 数格式化：1234567 → "1.23M"，890 → "890" */
export function formatTokens(n: number): string {
  if (n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * HTML 转义：ECharts 的 tooltip 默认 renderMode 是 `html`
 * （node_modules/echarts/lib/util/model.js:673 `return renderModeOption || 'html'`），
 * 内容最终走 `el.innerHTML`（TooltipHTMLContent.js:316）。
 * 而磁盘卷标、挂载点、进程名都来自本机外部数据 —— 卷标可以任意命名。
 * 任何进入 tooltip 的字符串都必须先转义，否则本地可被写入的卷标就是一条 XSS。
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
