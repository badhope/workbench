#!/usr/bin/env node
/**
 * 从 release-assets 生成 Tauri updater 的 latest.json。
 *
 * 只认「真正会被更新器消费的包」：
 * - Windows: *-setup.exe + .sig
 * - Linux:   *.AppImage + .sig
 * - macOS:   *.app.tar.gz + .sig
 *
 * 其他安装包（deb/dmg/zip）只供人工下载，不进 updater 清单；混进去会让
 * 更新器下载一个自己不会安装的格式。
 */
import fs from "node:fs";
import path from "node:path";

function arg(name, fallback = "") {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const assetsDir = path.resolve(arg("assets"));
const repo = arg("repo");
const version = arg("version");
const tag = arg("tag", `v${version}`);
const out = path.resolve(arg("out", path.join(assetsDir, "latest.json")));

if (!fs.existsSync(assetsDir)) throw new Error(`assets dir not found: ${assetsDir}`);
if (!repo) throw new Error("--repo is required");
if (!version) throw new Error("--version is required");

const files = fs
  .readdirSync(assetsDir)
  .filter((f) => fs.statSync(path.join(assetsDir, f)).isFile());

function findPayload(patterns, label) {
  const matches = files.filter(
    (f) => patterns.every((p) => p.test(f)) && !f.endsWith(".sig")
  );
  if (matches.length !== 1) {
    throw new Error(
      `${label}: expected exactly one payload, got ${matches.length}: ${matches.join(", ")}`
    );
  }
  const payload = matches[0];
  const sig = `${payload}.sig`;
  if (!files.includes(sig)) throw new Error(`${label}: missing signature ${sig}`);
  const signature = fs.readFileSync(path.join(assetsDir, sig), "utf8").trim();
  if (!signature) throw new Error(`${label}: empty signature ${sig}`);
  return { payload, signature };
}

const win = findPayload([/\.exe$/i], "Windows NSIS");
const linux = findPayload([/\.AppImage$/i], "Linux AppImage");
const mac = findPayload([/\.app\.tar\.gz$/i], "macOS app");

function urlFor(file) {
  return `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(file)}`;
}

const platforms = {
  "windows-x86_64": { signature: win.signature, url: urlFor(win.payload) },
  "linux-x86_64": { signature: linux.signature, url: urlFor(linux.payload) },
  // CI 的 macos-latest 是 arm64。Intel 包未构建时不要伪造 darwin-x86_64 条目。
  "darwin-aarch64": { signature: mac.signature, url: urlFor(mac.payload) },
};

let notes = `Workbench ${version}`;
const changelog = path.resolve("CHANGELOG.md");
if (fs.existsSync(changelog)) {
  const text = fs.readFileSync(changelog, "utf8");
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `^## \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`,
    "m"
  );
  const hit = text.match(re);
  if (hit) notes = hit[1].trim();
}

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms,
};

fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
console.log(`latest.json -> ${out}`);
for (const [platform, entry] of Object.entries(platforms)) {
  console.log(`  ${platform}: ${entry.url}`);
}
