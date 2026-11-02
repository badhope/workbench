/**
 * 版本一致性门禁。
 *
 * 为什么需要：版本号写在四个地方（package.json、package-lock.json、
 * tauri.conf.json、Cargo.toml）。任何一处漏改，都会让「应用内显示的版本」
 * 「安装包文件名」「Release 标题」各说各话 —— v0.3.0 之前的构建就踩过：
 * 锁文件根版本停在 0.1.1，而其余三处已经 0.3.0。
 *
 * 可选：传入 `--tag v0.4.0`（或设置 `GITHUB_REF_NAME`）时，额外校验 tag
 * 与版本一致。release.yml 的 preflight 会用到。
 *
 * 用法：
 *   node scripts/check-version.mjs
 *   node scripts/check-version.mjs --tag v0.4.0
 */
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

const sources = [];

const pkg = JSON.parse(read("package.json"));
sources.push({ file: "package.json", version: pkg.version });

const lock = JSON.parse(read("package-lock.json"));
sources.push({ file: "package-lock.json", version: lock.version });
if (lock.packages?.[""]?.version !== undefined) {
  sources.push({
    file: 'package-lock.json (packages[""])',
    version: lock.packages[""].version,
  });
}

const tauri = JSON.parse(read("src-tauri/tauri.conf.json"));
sources.push({ file: "src-tauri/tauri.conf.json", version: tauri.version });

const cargo = read("src-tauri/Cargo.toml");
const cargoVersion = cargo.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
sources.push({ file: "src-tauri/Cargo.toml", version: cargoVersion });

const cargoLock = read("src-tauri/Cargo.lock");
const lockVersion = cargoLock.match(
  /\[\[package\]\]\nname = "workbench"\nversion = "([^"]+)"/
)?.[1];
sources.push({ file: "src-tauri/Cargo.lock", version: lockVersion });

const semver = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const problems = [];

for (const { file, version } of sources) {
  if (!version) problems.push(`${file}: 缺少 version 字段`);
  else if (!semver.test(version))
    problems.push(`${file}: "${version}" 不是三段式 SemVer`);
}

const distinct = [...new Set(sources.map((s) => s.version).filter(Boolean))];
if (distinct.length > 1) {
  problems.push(`四处版本号不一致：${distinct.join(" / ")}`);
}

const args = process.argv.slice(2);
const tagIndex = args.indexOf("--tag");
const tag = tagIndex >= 0 ? args[tagIndex + 1] : process.env.GITHUB_REF_NAME;
if (tag) {
  const expected = tag.replace(/^v/, "");
  if (expected !== distinct[0]) {
    problems.push(`tag "${tag}" 与版本 "${distinct[0]}" 不一致`);
  }
}

if (problems.length > 0) {
  console.error("版本一致性检查失败：");
  for (const p of problems) console.error(`  - ${p}`);
  for (const s of sources) console.error(`    ${s.file} = ${s.version ?? "(missing)"}`);
  process.exit(1);
}

console.log(`版本一致：${distinct[0]}`);
for (const s of sources) console.log(`  ${s.file} = ${s.version}`);
