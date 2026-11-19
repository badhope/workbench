import { describe, expect, it } from "vitest";
import { PAGES } from "../../navigation";
import { dict as core } from "./core";
import { dict as overview } from "./overview";
import { dict as processes } from "./processes";
import { dict as servers } from "./servers";
import { dict as aisessions } from "./aisessions";
import { dict as projects } from "./projects";
import { dict as tasks } from "./tasks";
import { dict as settings } from "./settings";
import { dict as logs } from "./logs";
import { dict as today } from "./today";
import { dict as review } from "./review";
import { dict as mini } from "./mini";

/**
 * 三语词典对齐门禁。
 *
 * 原先只靠人工核对「三语必须同 key 同全」，加一条文案就可能漏翻某一语种，
 * 而 t() 的三级回退会让缺失的 key 静默显示成英文 —— 界面上看不出来。
 * 这里把这条约定变成测试：缺 key、多 key、占位符不一致都直接失败。
 */
const MODULES = {
  core,
  overview,
  processes,
  servers,
  aisessions,
  projects,
  tasks,
  settings,
  logs,
  today,
  review,
  mini,
};

const LANGS = ["en", "zh", "ja"] as const;

/**
 * 复数变体只存在于需要的语种（目前是英语）。
 * 对齐门禁比较「去掉 .one/.other」后的基础 key 集合，
 * 否则英文单复数会让中文/日文词典显得缺 key。
 */
const PLURAL_SUFFIX = /\.(zero|one|two|few|many|other)$/u;
const baseKey = (key: string) => key.replace(PLURAL_SUFFIX, "");
/** 只有「去掉后缀后的基础 key 确实存在」才算复数变体；`overview.cat.other` 是普通 key。 */
const isPlural = (dict: Record<string, string>, key: string) =>
  PLURAL_SUFFIX.test(key) && Object.hasOwn(dict, baseKey(key));

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

describe("i18n 三语对齐", () => {
  for (const [name, dict] of Object.entries(MODULES)) {
    it(`${name}: key 集合与占位符三语一致`, () => {
      const enKeys = Object.keys(dict.en).sort();
      const expected = [
        ...new Set(enKeys.map((k) => (isPlural(dict.en, k) ? baseKey(k) : k))),
      ].sort();
      for (const lang of LANGS) {
        const keys = [
          ...new Set(
            Object.keys(dict[lang]).map((k) =>
              isPlural(dict[lang] as Record<string, string>, k) ? baseKey(k) : k
            )
          ),
        ].sort();
        expect(keys, `${name}.${lang} 基础 key 与 en 不一致`).toEqual(expected);

        for (const key of enKeys.filter(
          (k) => !isPlural(dict.en as Record<string, string>, k)
        )) {
          const enVars = placeholders(dict.en[key as keyof typeof dict.en]);
          const otherVars = placeholders(
            dict[lang][key as keyof (typeof dict)[typeof lang]] as string
          );
          expect(otherVars, `${name}.${lang}「${key}」占位符与 en 不一致`).toEqual(
            enVars
          );
        }
      }
    });
  }

  it("英语复数变体必须带 count 占位符", () => {
    for (const [name, dict] of Object.entries(MODULES)) {
      for (const key of Object.keys(dict.en)) {
        if (!isPlural(dict.en as Record<string, string>, key)) continue;
        expect(
          placeholders(dict.en[key as keyof typeof dict.en]),
          `${name}.en「${key}」缺少 {count}`
        ).toContain("count");
        expect(baseKey(key), `${name}.en「${key}」没有基础文案`).toBeTruthy();
      }
    }
  });

  it("每条文案都非空（空串会让界面出现空白）", () => {
    for (const [name, dict] of Object.entries(MODULES)) {
      for (const lang of LANGS) {
        for (const [key, value] of Object.entries(dict[lang])) {
          expect(String(value).trim(), `${name}.${lang}「${key}」为空`).not.toBe("");
        }
      }
    }
  });

  // 页面注册表是导航的唯一来源，但 t() 的签名接受任意 string：
  // 新增页面时若忘了补 app.nav.* / app.title.*，运行时会直接渲染出
  // 字面量 "app.nav.reports"，界面看着像 bug 却不报错。这里把它变成测试失败。
  it("注册表里每个页面都有三语导航与标题文案", () => {
    for (const page of PAGES) {
      for (const lang of LANGS) {
        const dict = core[lang] as Record<string, string>;
        for (const prefix of ["app.nav", "app.title"]) {
          const key = `${prefix}.${page.key}`;
          expect(dict[key], `缺少 ${lang} 的 ${key}`).toBeTruthy();
        }
      }
    }
  });
});
