import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "./store";
import { effectiveMotion, migratePersisted, prefersReducedMotion } from "./store";
import type { ThemeInput } from "./theme/tokens";
import { BUILTIN_THEMES, DEFAULT_THEME_ID } from "./theme/presets";
import { DEFAULT_ORDER } from "./layout";

/**
 * store 里的主题 / 外壳 / 布局 / 组件摆放状态。
 *
 * 这些是全应用共享的偏好，任何一条回归都会让「用户选的东西重启后消失」，
 * 而单元测试之外（Playwright）只能覆盖到少数几条路径。
 */

function reset() {
  useStore.setState({
    theme: DEFAULT_THEME_ID,
    customThemes: [],
    motion: "standard",
    motionExplicit: false,
    onboardingDone: false,
    shell: "rail",
    layout: "bento",
    widgetOrder: DEFAULT_ORDER,
    widgetHidden: [],
  });
  document.documentElement.dataset.theme = DEFAULT_THEME_ID;
  document.documentElement.dataset.shell = "rail";
  document.documentElement.dataset.layout = "bento";
  document.documentElement.dataset.motion = "standard";
}

const customTheme = (over: Partial<ThemeInput> = {}): ThemeInput => ({
  id: "custom-a",
  name: "Custom A",
  dark: true,
  bg: "#101010",
  panel: "#181818",
  text: "#f0f0f0",
  accent: "#ff8800",
  radiusCard: 8,
  radiusBtn: 6,
  density: "cozy",
  font: "sans",
  material: "line",
  grid: 0,
  panelOpacity: 1,
  builtin: false,
  ...over,
});

describe("主题状态", () => {
  beforeEach(reset);

  it("setTheme 切换内置主题并写入 dataset + CSS 变量", () => {
    useStore.getState().setTheme("frost");
    expect(useStore.getState().theme).toBe("frost");
    expect(document.documentElement.dataset.theme).toBe("frost");
    // 浅色主题的底色变量必须真的换了（而不是只改了个 id）
    const bg = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-bg")
      .trim();
    expect(bg.toLowerCase()).toBe("#f2f4f7");
  });

  it("upsertTheme 新建自定义主题并立即生效", () => {
    const id = useStore.getState().upsertTheme(customTheme());
    expect(id).toBe("custom-a");
    expect(useStore.getState().customThemes).toHaveLength(1);
    expect(useStore.getState().theme).toBe("custom-a");
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-accent")
      .trim();
    expect(accent.toLowerCase()).toBe("#ff8800");
  });

  it("upsertTheme 同 id 覆盖而不是追加", () => {
    useStore.getState().upsertTheme(customTheme());
    useStore.getState().upsertTheme(customTheme({ accent: "#00ff00" }));
    expect(useStore.getState().customThemes).toHaveLength(1);
    expect(useStore.getState().customThemes[0].accent).toBe("#00ff00");
  });

  it("upsertTheme 传入 builtin 时不写自定义列表，只切换选中项", () => {
    // 内置主题随版本升级更新，用户副本不该覆盖它们；
    // 但「选中某套内置主题」是合法操作，必须真的切过去。
    const id = useStore.getState().upsertTheme({ ...BUILTIN_THEMES[0], builtin: true });
    expect(id).toBe(BUILTIN_THEMES[0].id);
    expect(useStore.getState().customThemes).toHaveLength(0);
    expect(useStore.getState().theme).toBe(BUILTIN_THEMES[0].id);
  });

  it("upsertTheme 传 builtin 但 id 未知时不制造悬空引用", () => {
    // 真实风险：theme 被设成一个在列表里不存在的 id，
    // tokensFor 回退第一套主题 → 界面与状态不一致。
    const id = useStore.getState().upsertTheme({
      ...BUILTIN_THEMES[0],
      id: "ghost",
      builtin: true,
    });
    expect(id).toBe("ghost");
    // 未匹配任何内置主题时回退默认，而不是留下悬空 id
    expect(useStore.getState().theme).toBe(DEFAULT_THEME_ID);
  });

  it("deleteTheme 删除自定义主题；若当前正在用它则回退默认主题", () => {
    useStore.getState().upsertTheme(customTheme());
    expect(useStore.getState().theme).toBe("custom-a");
    useStore.getState().deleteTheme("custom-a");
    expect(useStore.getState().customThemes).toHaveLength(0);
    expect(useStore.getState().theme).toBe(DEFAULT_THEME_ID);
  });

  it("deleteTheme 删除非当前主题时不影响当前选择", () => {
    useStore.getState().upsertTheme(customTheme({ id: "x", name: "X" }));
    useStore.getState().upsertTheme(customTheme({ id: "y", name: "Y" }));
    useStore.getState().setTheme("x");
    useStore.getState().deleteTheme("y");
    expect(useStore.getState().theme).toBe("x");
  });
});

describe("主题导入", () => {
  beforeEach(reset);

  it("合法 JSON 被接受并切到该主题", () => {
    const json = JSON.stringify({
      id: "imported",
      name: "Imported",
      bg: "#000000",
      panel: "#111111",
      text: "#ffffff",
      accent: "#123456",
    });
    const res = useStore.getState().importTheme(json);
    expect(res.ok).toBe(true);
    expect(res.id).toBe("imported");
    expect(useStore.getState().theme).toBe("imported");
  });

  it("非 JSON 返回错误而不是抛异常", () => {
    const res = useStore.getState().importTheme("not json {");
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it("缺字段的主题被拒绝", () => {
    const res = useStore.getState().importTheme(JSON.stringify({ id: "x", name: "X" }));
    expect(res.ok).toBe(false);
  });

  it("id 与内置主题冲突时自动改名，不覆盖内置主题", () => {
    const json = JSON.stringify({
      id: "midnight",
      name: "Hijack",
      bg: "#000000",
      panel: "#111111",
      text: "#ffffff",
      accent: "#123456",
    });
    const res = useStore.getState().importTheme(json);
    expect(res.ok).toBe(true);
    expect(res.id).not.toBe("midnight");
    // 内置主题本身没有被改写
    const builtinMidnight = BUILTIN_THEMES.find((t) => t.id === "midnight")!;
    const applied = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-bg")
      .trim();
    expect(applied.toLowerCase()).not.toBe(builtinMidnight.bg.toLowerCase());
  });
});

describe("外壳 / 布局 / 组件摆放", () => {
  beforeEach(reset);

  it("setShell 写入 dataset 且保留主题", () => {
    useStore.getState().setTheme("frost");
    useStore.getState().setShell("dock");
    expect(document.documentElement.dataset.shell).toBe("dock");
    expect(document.documentElement.dataset.theme).toBe("frost");
  });

  it("setLayout 写入 dataset（否则 CSS 与测试都读不到当前版面）", () => {
    useStore.getState().setLayout("orbit");
    expect(useStore.getState().layout).toBe("orbit");
    expect(document.documentElement.dataset.layout).toBe("orbit");
  });

  it("setWidgetOrder 清洗未知 id 并补齐缺失项", () => {
    useStore.getState().setWidgetOrder(["tasks", "bogus", "tasks"] as never);
    const order = useStore.getState().widgetOrder;
    expect(order[0]).toBe("tasks");
    expect(order).toHaveLength(DEFAULT_ORDER.length);
    expect(order).not.toContain("bogus");
  });

  it("setWidgetHidden 只保留已知 id", () => {
    useStore.getState().setWidgetHidden(["disks", "nope"] as never);
    expect(useStore.getState().widgetHidden).toEqual(["disks"]);
  });

  it("resetWidgets 恢复默认顺序并清空隐藏", () => {
    useStore.getState().setWidgetOrder(["tasks", ...DEFAULT_ORDER] as never);
    useStore.getState().setWidgetHidden(["disks"] as never);
    useStore.getState().resetWidgets();
    expect(useStore.getState().widgetOrder).toEqual(DEFAULT_ORDER);
    expect(useStore.getState().widgetHidden).toEqual([]);
  });
});

/**
 * 动效档位与首启引导（视觉 2.0，persist v4）。
 *
 * 三档设置是「即时生效 + 持久化」的承诺：生效逻辑只此一处
 * （effectiveMotion），档位落 DOM 只有 data-motion 一个属性。
 */
describe("动效与引导偏好", () => {
  beforeEach(reset);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("默认档位是 standard，motionExplicit / onboardingDone 为 false", () => {
    const s = useStore.getState();
    expect(s.motion).toBe("standard");
    expect(s.motionExplicit).toBe(false);
    expect(s.onboardingDone).toBe(false);
  });

  it("setMotion 立即写入 data-motion 并标记为显式选择", () => {
    useStore.getState().setMotion("rich");
    expect(useStore.getState().motion).toBe("rich");
    expect(useStore.getState().motionExplicit).toBe(true);
    expect(document.documentElement.dataset.motion).toBe("rich");
  });

  it("setOnboardingDone 置 true 后不再回头（重启也不复弹由 persist 保证）", () => {
    useStore.getState().setOnboardingDone();
    expect(useStore.getState().onboardingDone).toBe(true);
  });

  it("effectiveMotion：未显式选择时系统 reduced-motion 压成 off", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true }) as unknown as typeof matchMedia
    );
    expect(prefersReducedMotion()).toBe(true);
    expect(effectiveMotion({ motion: "standard", motionExplicit: false })).toBe("off");
    // 用户显式选过档位 → 允许覆盖系统设置
    expect(effectiveMotion({ motion: "standard", motionExplicit: true })).toBe(
      "standard"
    );
    expect(effectiveMotion({ motion: "rich", motionExplicit: true })).toBe("rich");
  });

  it("effectiveMotion：显式选 off 永远是 off，无 matchMedia 的环境视为系统未要求", () => {
    expect(effectiveMotion({ motion: "off", motionExplicit: true })).toBe("off");
    expect(effectiveMotion({ motion: "off", motionExplicit: false })).toBe("off");
    // jsdom 默认没有 matchMedia —— 不允许这里抛错
    expect(prefersReducedMotion()).toBe(false);
    expect(effectiveMotion({ motion: "rich", motionExplicit: false })).toBe("rich");
  });
});

/** persist v3 → v4 迁移：只补默认值，不覆盖用户数据。 */
describe("persist 迁移 v3→v4", () => {
  it("旧版 payload（v3）补齐动效与引导默认值", () => {
    const migrated = migratePersisted({
      theme: "frost",
      shell: "dock",
      layout: "ledger",
      procView: "tree",
    });
    expect(migrated.theme).toBe("frost");
    expect(migrated.shell).toBe("dock");
    expect(migrated.layout).toBe("ledger");
    expect(migrated.procView).toBe("tree");
    expect(migrated.motion).toBe("standard");
    expect(migrated.motionExplicit).toBe(false);
    expect(migrated.onboardingDone).toBe(false);
    expect(migrated.particles).toBe(false);
  });

  it("用户已保存的偏好不被覆盖，非法档位回退 standard", () => {
    const migrated = migratePersisted({
      motion: "off",
      motionExplicit: true,
      onboardingDone: true,
      particles: true,
    });
    expect(migrated.motion).toBe("off");
    expect(migrated.motionExplicit).toBe(true);
    expect(migrated.onboardingDone).toBe(true);
    expect(migrated.particles).toBe(true);

    const bad = migratePersisted({ motion: "turbo" });
    expect(bad.motion).toBe("standard");
  });

  it("null / undefined payload 不抛错，全部落默认", () => {
    for (const input of [null, undefined, {}]) {
      const migrated = migratePersisted(input);
      expect(migrated.motion).toBe("standard");
      expect(migrated.motionExplicit).toBe(false);
      expect(migrated.onboardingDone).toBe(false);
      expect(migrated.particles).toBe(false);
    }
  });

  it("persist v4 payload（无 particles 字段）升到 v5 时补默认关", () => {
    // 模拟上一版（v4）用户的真实存储：有动效偏好、没有粒子字段
    const migrated = migratePersisted({
      motion: "rich",
      motionExplicit: true,
      onboardingDone: true,
    });
    expect(migrated.motion).toBe("rich");
    expect(migrated.particles).toBe(false);
  });

  it("persist v5 → v6：粒子强度默认 65 且钳制，背景图只收 data:image/*", () => {
    // 合法强度保留取整，越界截断
    expect(migratePersisted({ particlesIntensity: 80 }).particlesIntensity).toBe(80);
    expect(migratePersisted({ particlesIntensity: 250 }).particlesIntensity).toBe(100);
    expect(migratePersisted({ particlesIntensity: -3 }).particlesIntensity).toBe(0);
    expect(migratePersisted({}).particlesIntensity).toBe(65);
    expect(migratePersisted({ particlesIntensity: "abc" }).particlesIntensity).toBe(65);

    // 背景图白名单：data:image/* 放行，其它（含 script: 和 http:）一律 null
    const good = "data:image/png;base64,iVBORw0KGgo=";
    expect(migratePersisted({ backgroundImage: good }).backgroundImage).toBe(good);
    expect(
      migratePersisted({ backgroundImage: "data:text/html;base64,PGI+" }).backgroundImage
    ).toBeNull();
    expect(
      migratePersisted({ backgroundImage: "https://evil.example/x.png" }).backgroundImage
    ).toBeNull();
    expect(migratePersisted({ backgroundImage: 42 }).backgroundImage).toBeNull();
    expect(migratePersisted({}).backgroundImage).toBeNull();
  });
});

/** persist v6 → v7：工作方式、任务视图与当前视图。 */
describe("persist 迁移 v6→v7", () => {
  it("旧用户没有工作方式字段时补默认值，并视为已选择", () => {
    const migrated = migratePersisted({ onboardingDone: true, theme: "frost" });
    expect(migrated.workModes).toEqual(["development", "project"]);
    expect(migrated.workModeChosen).toBe(true);
  });

  it("新用户未完成引导时保留空选择，交给首启决定", () => {
    const migrated = migratePersisted({ onboardingDone: false });
    expect(migrated.workModes).toEqual([]);
    expect(migrated.workModeChosen).toBe(false);
  });

  it("合法工作方式保留，未知值丢弃，custom 互斥", () => {
    expect(migratePersisted({ workModes: ["content", "research"] }).workModes).toEqual([
      "content",
      "research",
    ]);
    expect(migratePersisted({ workModes: ["ghost", "project"] }).workModes).toEqual([
      "project",
    ]);
    expect(migratePersisted({ workModes: ["custom", "project"] }).workModes).toEqual([
      "custom",
    ]);
  });

  it("任务视图 / 范围 / 项目筛选做白名单回退", () => {
    const bad = migratePersisted({
      taskView: "grid",
      taskScope: "someday",
      taskProjectFilter: 42,
    });
    expect(bad.taskView).toBe("list");
    expect(bad.taskScope).toBe("all");
    expect(bad.taskProjectFilter).toBe("");

    const good = migratePersisted({
      taskView: "board",
      taskScope: "week",
      taskProjectFilter: "p1",
    });
    expect(good.taskView).toBe("board");
    expect(good.taskScope).toBe("week");
    expect(good.taskProjectFilter).toBe("p1");
  });
});
