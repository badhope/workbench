#!/usr/bin/env node
/**
 * 模块边界门禁（零依赖，CI 与本地共用）。
 *
 * 只拦「结构性错误」：依赖倒置、传输层泄漏、IPC/HTTP 重复实现。
 * 文件体量只报警告，不拦提交——拆分是渐进的，不能因为一次提交没拆完就红。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const RUST = path.join(ROOT, "src-tauri", "src");
const failures = [];
const warnings = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function importsOf(text) {
  const out = [];
  for (const m of text.matchAll(/from\s+["']([^"']+)["']/g)) out.push(m[1]);
  for (const m of text.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}

function inspectFrontend() {
  for (const file of walk(SRC)) {
    const text = fs.readFileSync(file, "utf8");
    const name = rel(file);
    const dir = path.dirname(name).split(path.sep).join("/");
    for (const spec of importsOf(text)) {
      if (!spec.startsWith(".")) continue;
      const target = path.normalize(path.join(dir, spec)).split(path.sep).join("/");
      if (
        (dir.startsWith("src/lib") || dir.startsWith("src/components")) &&
        target.startsWith("src/pages")
      ) {
        failures.push(`${name} 反向依赖页面层: ${spec}`);
      }
      if (name !== "src/navigation.tsx" && target === "src/pages") {
        failures.push(`${name} 绕过 navigation 直接引用 pages 目录`);
      }
      if (name !== "src/lib/api.ts" && /@tauri-apps\/api\/core/.test(spec)) {
        failures.push(`${name} 直接引用 Tauri core，应统一走 lib/api.ts`);
      }
    }
    const lines = text.split("\n").length;
    if (lines > 800) warnings.push(`${name} 体积 ${lines} 行，建议继续拆分`);
  }
}

function inspectRust() {
  const commands = path.join(RUST, "commands.rs");
  const server = path.join(RUST, "server.rs");
  const checks = [
    [
      commands,
      /PORTS_TTL|build_pid_index|devserver::classify_dev_server/,
      "commands.rs 出现端口缓存/dev-server 重复实现，应调用 runtime",
    ],
    [
      server,
      /ports::collect|devserver::classify_dev_server/,
      "server.rs 重复运行时采集逻辑，应调用 runtime",
    ],
  ];
  for (const [file, re, message] of checks) {
    if (fs.existsSync(file) && re.test(fs.readFileSync(file, "utf8"))) {
      failures.push(`${rel(file)}: ${message}`);
    }
  }
}

inspectFrontend();
inspectRust();

for (const w of warnings) console.warn(`[warn] ${w}`);
if (failures.length) {
  for (const f of failures) console.error(`[fail] ${f}`);
  console.error(`\n模块边界检查失败：${failures.length} 处`);
  process.exit(1);
}
console.log(`模块边界检查通过（${warnings.length} 个体量警告）`);
