/**
 * 本地复跑 CI。
 *
 * 为什么需要它：`act` 只能跑容器化的 job，而本项目的 CI 全是
 * `windows-latest` / `ubuntu-latest` 原生 runner；Windows 侧的两条 job
 * 其实可以在本机一条命令跑完，没必要等远端排期。
 *
 * 与 .github/workflows/ci.yml 的关系：命令逐条对齐（顺序也一致），
 * 任一步失败立即退出，并打印「哪一步 / 哪条命令 / 退出码」。
 * 这个脚本是**本地镜像**，不是替代：Linux 的 deb 打包、macOS 构建
 * 仍然只能在对应 runner 上跑（`--linux` 会尝试用 Docker，没有则跳过并说明）。
 *
 * 用法：
 *   node scripts/ci-local.mjs            # 全部可在 Windows 本地跑的步骤
 *   node scripts/ci-local.mjs --fast     # 跳过耗时最长的 Playwright 视觉回归
 *   node scripts/ci-local.mjs --linux    # 额外尝试在 Docker 里跑 Rust 测试
 *   node scripts/ci-local.mjs --full     # 额外构建 NSIS 安装包并校验产物
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FAST = process.argv.includes("--fast");
const LINUX = process.argv.includes("--linux");
const FULL = process.argv.includes("--full");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const steps = [
  { name: "Icon contract", cmd: "python", args: ["scripts/check_icons.py"] },
  { name: "Version consistency", cmd: "npm", args: ["run", "version:check"] },
  { name: "Typecheck", cmd: "npx", args: ["tsc", "--noEmit"] },
  { name: "Lint", cmd: "npm", args: ["run", "lint"] },
  { name: "Format check", cmd: "npx", args: ["prettier", "--check", "."] },
  { name: "Duplication < 3%", cmd: "npm", args: ["run", "dup"] },
  // 与 CI 一致，只审计生产依赖并以 high 为失败阈值。
  // 本地 registry 不可用时会尝试官方 registry；仍不可用则失败，见 runAudit。
  { name: "npm audit (prod, >=high)", custom: runAudit },
  // 与 ci.yml 一致：一次 coverage 同时跑单元测试并执行阈值。
  // 阈值写在 vitest.config.mts，普通 `npm test` 不会触发。
  { name: "Unit tests + coverage", cmd: "npm", args: ["run", "coverage"] },
  { name: "Build", cmd: "npm", args: ["run", "build"] },
  {
    name: "Visual regression",
    cmd: "npx",
    args: ["playwright", "test", "--workers=1"],
    skip: FAST,
    reason: "--fast",
  },
  {
    name: "Rust format",
    cmd: "cargo",
    args: ["fmt", "--all", "--", "--check"],
    cwd: "src-tauri",
  },
  { name: "Rust tests", cmd: "cargo", args: ["test"], cwd: "src-tauri" },
  {
    name: "Rust clippy",
    cmd: "cargo",
    args: ["clippy", "--all-targets", "--", "-D", "warnings"],
    cwd: "src-tauri",
  },
  {
    name: "IPC contract drift",
    cmd: "cargo",
    args: ["test", "--test", "export_bindings"],
    cwd: "src-tauri",
    after: checkContractDrift,
  },
];

if (FULL) {
  // 与 release.yml 的 nsis 分支对齐：打包成功不等于产物落地，必须校验
  // 文件名、数量和非空。默认不跑：一次 NSIS 构建要拉 toolchain 和打包器，
  // 不适合每次本地门禁。
  steps.push({
    name: "Windows installer (NSIS)",
    cmd: "npx",
    args: ["tauri", "build", "--bundles", "nsis"],
    after: verifyWindowsInstaller,
  });
}

function checkContractDrift() {
  const r = spawnSync("git", ["status", "--porcelain", "--", "src/generated"], {
    encoding: "utf8",
  });
  if (r.stdout.trim()) {
    console.error("  src/generated 与 Rust 结构体不一致：");
    console.error(r.stdout.trim());
    console.error("  修复：cd src-tauri && cargo test --test export_bindings");
    return false;
  }
  return true;
}

// registry 不支持 audit 接口 / 网络不可达的典型特征。命中这些说明
// 「没有验证过」，而不是「验证通过」。
const AUDIT_UNREACHABLE =
  /NOT_IMPLEMENTED|audit endpoint returned an error|404 Not Found|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|getaddrinfo/i;

function auditOnce(extraArgs) {
  return spawnSync("npm", ["audit", "--omit=dev", "--audit-level=high", ...extraArgs], {
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, CI: "true" },
  });
}

function runAudit() {
  const started = Date.now();
  let r = auditOnce([]);
  let out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status !== 0 && AUDIT_UNREACHABLE.test(out)) {
    console.log("  当前 registry 不支持 audit 接口，改用 registry.npmjs.org 只读重试");
    r = auditOnce(["--registry=https://registry.npmjs.org"]);
    out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  }
  process.stdout.write(out.endsWith("\n") || !out ? out : `${out}\n`);
  const ms = Date.now() - started;
  if (r.status === 0) {
    console.log(`ok   npm audit（${(ms / 1000).toFixed(1)}s）`);
    return true;
  }
  if (AUDIT_UNREACHABLE.test(out)) {
    console.error(
      "\nUNVERIFIED npm audit：registry/网络不可用，没有拿到任何审计结果。按 fail-closed 记为失败，不得当作通过。"
    );
    console.error(
      "  重试：npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org"
    );
  } else {
    console.error(
      "\nFAIL npm audit：生产依赖存在 >= high 的已知漏洞，或 npm audit 自身失败"
    );
  }
  console.error(
    `  命令: npm audit --omit=dev --audit-level=high（exit ${r.status}, ${(ms / 1000).toFixed(1)}s）`
  );
  return false;
}

function verifyWindowsInstaller() {
  const dir = join("src-tauri", "target", "release", "bundle", "nsis");
  if (!existsSync(dir)) {
    console.error(`  产物目录不存在：${dir}`);
    return false;
  }
  const installers = readdirSync(dir).filter((f) => f.endsWith("-setup.exe"));
  if (installers.length !== 1) {
    console.error(`  期望恰好 1 个 *-setup.exe，实际 ${installers.length} 个`);
    console.error(`  目录内容：${readdirSync(dir).join(", ") || "<空>"}`);
    return false;
  }
  const file = join(dir, installers[0]);
  const bytes = statSync(file).size;
  if (bytes <= 0) {
    console.error(`  安装包是空文件：${file}`);
    return false;
  }
  if (!installers[0].includes(pkg.version)) {
    console.error(`  安装包文件名不含版本 ${pkg.version}：${installers[0]}`);
    return false;
  }
  console.log(`  产物：${file}（${bytes} bytes）`);
  return true;
}

function run(step) {
  const started = Date.now();
  if (step.custom) {
    return step.custom();
  }
  const r = spawnSync(step.cmd, step.args, {
    cwd: step.cwd ?? ".",
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, CI: "true" },
  });
  const ms = Date.now() - started;
  if (r.status !== 0) {
    console.error(`\nFAIL ${step.name}（exit ${r.status}, ${(ms / 1000).toFixed(1)}s）`);
    console.error(
      `  命令: ${step.cmd} ${step.args.join(" ")}${step.cwd ? `（在 ${step.cwd}/）` : ""}`
    );
    return false;
  }
  if (step.after && !step.after()) {
    console.error(`\nFAIL ${step.name}（后置检查未通过）`);
    return false;
  }
  console.log(`ok   ${step.name}（${(ms / 1000).toFixed(1)}s）`);
  return true;
}

let passed = 0;
let failed = 0;
const skipped = [];
for (const step of steps) {
  if (step.skip) {
    console.log(`skip ${step.name}（${step.reason}）`);
    skipped.push(step.name);
    continue;
  }
  if (!run(step)) {
    failed++;
    break;
  }
  passed++;
}

if (!FULL) {
  console.log(
    "skip Windows installer（默认跳过：未加 --full，不构建 NSIS 安装包；此项不计为通过，发布前必须在 runner 上验证）"
  );
  skipped.push("Windows installer");
}

if (LINUX) {
  // Linux job 只能在 Linux 上跑。这里用 Docker 试一次；没有可用的
  // Docker 就明确说明「本地无法覆盖」，而不是假装通过。
  const docker = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8",
  });
  if (docker.status === 0) {
    console.log("\nDocker 可用：在 ubuntu:24.04 里跑 Rust 测试（对齐 backend-linux）");
    const r = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "-v",
        `${process.cwd()}:/w`,
        "-w",
        "/w/src-tauri",
        "ubuntu:24.04",
        "bash",
        "-lc",
        "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl build-essential pkg-config libssl-dev libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev >/dev/null && curl -sSf https://sh.rustup.rs | sh -s -- -y >/dev/null && . $HOME/.cargo/env && cargo test",
      ],
      { stdio: "inherit" }
    );
    if (r.status !== 0) failed++;
  } else {
    console.log("\nskip Linux job（Docker 守护进程不可用）");
    console.log("  这一步无法在本地覆盖；由 GitHub Actions 的 ubuntu-latest 负责。");
    skipped.push("Linux job");
  }
}

console.log(
  `\n${failed ? "FAILED" : "PASSED"}：${passed} 步通过，${skipped.length} 步跳过，${failed} 步失败`
);
if (skipped.length) {
  console.log(`  未覆盖：${skipped.join("、")}（跳过不等于通过）`);
}
process.exit(failed ? 1 : 0);
