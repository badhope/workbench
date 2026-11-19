import { describe, expect, it } from "vitest";
import libSource from "../../src-tauri/src/lib.rs?raw";

/**
 * IPC 命令名契约。
 *
 * 前端 `invoke("get_pricing")` 里的字符串和后端 `generate_handler![...]`
 * 里的函数名是两处独立维护的字面量：名字对不上时 TypeScript 完全看不出来，
 * 运行时才报 "command not found"，而且只在用户点到那个功能时才发现。
 * 这条测试把两边拉到一个断言里。
 *
 * 用 Vite 的 `?raw` / `import.meta.glob` 读取源码，不依赖 Node 的 fs——
 * 前端工程没有（也不需要）`@types/node`，为了一个测试引入整套 Node 类型
 * 只会让生产依赖树变脏。
 *
 * 只检查命令名，不检查参数：参数名由 ts-rs 生成的类型与 Rust 结构体约束，
 * 且 Tauri 会把 camelCase 自动映射到 snake_case，做字符串比对会产生误报。
 */
const SOURCES = import.meta.glob<string>(["../**/*.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
});

function rustCommands(): Set<string> {
  const start = libSource.indexOf("tauri::generate_handler![");
  expect(start, "lib.rs 里找不到 generate_handler").toBeGreaterThan(-1);
  const end = libSource.indexOf("])", start);
  const block = libSource.slice(start, end);
  const out = new Set<string>();
  for (const m of block.matchAll(/(?:commands|crate::[\w:]+)::([a-z0-9_]+)/g)) {
    out.add(m[1]);
  }
  return out;
}

function tsInvokes(): { cmd: string; file: string }[] {
  const out: { cmd: string; file: string }[] = [];
  for (const [file, src] of Object.entries(SOURCES)) {
    if (/\.test\./.test(file) || file.includes("/generated/")) continue;
    for (const m of src.matchAll(/invoke(?:<[^>]*>)?\(\s*["'`]([a-z0-9_]+)["'`]/g)) {
      out.push({ cmd: m[1], file });
    }
  }
  return out;
}

describe("IPC 命令名", () => {
  const registered = rustCommands();
  const calls = tsInvokes();

  it("后端已注册命令", () => {
    expect(registered.size).toBeGreaterThan(20);
  });

  it("前端每个 invoke 都在后端注册过", () => {
    const missing = calls.filter((c) => !registered.has(c.cmd));
    expect(
      missing,
      `未注册的命令：${missing.map((m) => `${m.cmd} (${m.file})`).join(", ")}`
    ).toEqual([]);
  });

  it("定价命令成对存在（读 + 写）", () => {
    expect(registered.has("get_pricing")).toBe(true);
    expect(registered.has("save_pricing")).toBe(true);
    expect(calls.some((c) => c.cmd === "get_pricing")).toBe(true);
    expect(calls.some((c) => c.cmd === "save_pricing")).toBe(true);
  });

  it("扫描出足够多的前端调用点（防止 glob 匹配失效导致空跑通过）", () => {
    // 这条是「测试自身有效性」的守卫：如果 glob 没匹配到文件，
    // 上面的断言会因为空数组而永远通过 —— 那才是真的假绿灯。
    // 传输层已收敛到 api.ts：所有 invoke 必须集中在一个文件。
    // 数量阈值挡住 glob 失效；文件集合断言挡住“又有人绕过 api.ts 直接 invoke”。
    expect(calls.length).toBeGreaterThan(25);
    const files = new Set(calls.map((c) => c.file));
    expect(files.size).toBe(1);
    expect([...files][0]).toBe("./api.ts");
  });
});
