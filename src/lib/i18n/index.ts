// ── 轻量 i18n 引擎 ──────────────────────────────────────────────
// 设计约束：
//  - 不引第三方库；引擎与 UI 框架解耦，store.ts 等非组件模块可直接调用 t()
//  - 语言状态独立于 zustand store（避免循环依赖），自持 localStorage 持久化
//  - 页面文案按页面拆文件（core + 8 个页面词典），在此合并；key 缺失时回退英语，
//    再回退 key 本身，保证永不渲染空白
//  - 插值用 {name} 占位：t("store.killSent", { pid: 123 })
import { useMemo, useSyncExternalStore } from "react";
import { dict as core } from "./core";
import { dict as overview } from "./overview";
import { dict as processes } from "./processes";
import { dict as servers } from "./servers";
import { dict as aisessions } from "./aisessions";
import { dict as projects } from "./projects";
import { dict as tasks } from "./tasks";
import { dict as settings } from "./settings";
import { dict as logs } from "./logs";

export type Lang = "en" | "zh" | "ja";

/** 应用版本号：构建时由 vite.config.ts 从 package.json 注入，不在这里手抄 */
export const APP_VERSION = __APP_VERSION__;

type Dict = Record<string, string>;

const DICTS: Record<Lang, Dict> = {
  en: {
    ...core.en,
    ...overview.en,
    ...processes.en,
    ...servers.en,
    ...aisessions.en,
    ...projects.en,
    ...tasks.en,
    ...settings.en,
    ...logs.en,
  },
  zh: {
    ...core.zh,
    ...overview.zh,
    ...processes.zh,
    ...servers.zh,
    ...aisessions.zh,
    ...projects.zh,
    ...tasks.zh,
    ...settings.zh,
    ...logs.zh,
  },
  ja: {
    ...core.ja,
    ...overview.ja,
    ...processes.ja,
    ...servers.ja,
    ...aisessions.ja,
    ...projects.ja,
    ...tasks.ja,
    ...settings.ja,
    ...logs.ja,
  },
};

const STORAGE_KEY = "workbench-lang";
// 默认中文：产品的主要使用者是中文用户；英文/日文在设置页可切换。
// 旧版本显式存下的 "en" 仍然优先（用户自己选过就不覆盖）。
const DEFAULT_LANG: Lang = "zh";

function loadLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "en" || v === "zh" || v === "ja") return v;
  } catch {
    /* 非浏览器环境忽略 */
  }
  return DEFAULT_LANG;
}

let current: Lang = loadLang();
const listeners = new Set<() => void>();

/** 当前语言（非组件模块用，如 store 的 toast） */
export function getLang(): Lang {
  return current;
}

export function setLang(l: Lang): void {
  if (l === current) return;
  current = l;
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {
    /* 忽略 */
  }
  document.documentElement.lang = localeFor(l);
  listeners.forEach((fn) => fn());
}

export function subscribeLang(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React 组件订阅当前语言 */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, getLang);
}

/** 组件内取翻译函数；按语言记忆，同一语言下引用稳定（可安全进 useMemo 依赖） */
export function useT() {
  const l = useLang();
  return useMemo(
    () => (key: string, vars?: Record<string, string | number>) => t(key, vars, l),
    [l]
  );
}

/**
 * 翻译：当前语言 → 英语 → key 本身，三级回退。
 *
 * 插值用**函数替换器**而不是直接传字符串：
 * - 字符串形式下 `$&`、`` $` ``、`$$` 等会被当作替换模式展开，
 *   而变量值经常是错误信息、路径、进程名，含 `$` 并不罕见
 * - 函数返回值不会被再次解析，因此也消除了「值里含 {otherVar} 被二次替换」
 */
export function t(
  key: string,
  vars?: Record<string, string | number>,
  lang?: Lang
): string {
  const l = lang ?? current;
  let s = DICTS[l]?.[key] ?? DICTS.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      const value = String(v);
      s = s.replaceAll(`{${k}}`, () => value);
    }
  }
  return s;
}

/** 各语言对应的 BCP-47 locale（时间/数字格式化用） */
export function localeFor(l: Lang): string {
  return l === "zh" ? "zh-CN" : l === "ja" ? "ja-JP" : "en-US";
}

/** 启动时把 <html lang> 同步成当前语言 */
export function syncDocumentLang(): void {
  document.documentElement.lang = localeFor(current);
}
