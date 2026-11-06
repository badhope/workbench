# Workbench

**English** | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

[![Version](https://img.shields.io/badge/version-0.7.0-22d3ee)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-34d399)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-0078d4)](docs/ARCHITECTURE.md#system-requirements)
[![Tests](https://img.shields.io/badge/tests-532%20unit%20%2B%20161%20backend-8b5cf6)](#quality-gates)

![Workbench](docs/screenshots/12-brand-hero.png)

**See the port. Find the process. Know the cost.**

A local-first desktop workbench for people who run services and AI coding
agents on their own machine. One window shows every process, listening port,
dev server, project, task — and what your Claude Code / Codex sessions actually
cost. Data never leaves the device, and there is no account, no cloud, no model
to configure.

## What makes it different

| | |
|---|---|
| **Port → process → cost** | A listening port links to the process that owns it, and a process shows every port it holds. Session files connect the same machine's work to real spend. No other local tool joins those three views. |
| **Understands dev servers** | Not just "port open": Vite, Next, Nuxt, Django, uvicorn, Rails and 30+ more are recognised from the command line, with a confidence level. |
| **Keyboard-first** | Ctrl/Cmd+K searches every page, process, port, project and task. Flat table or parent/child tree. Everything reachable without the mouse. |
| **Trustworthy by construction** | Protected system processes are rejected in Rust, the target identity is re-checked right before a kill, UAC elevation is opt-in per action, and every report states what it verified. |
| **Local-first, honestly** | SQLite ledger on your disk, CSP locked to `self`, no telemetry. The only outbound request is the optional probe of a local opencode server. |

## Three ways to run it

| Mode | Start it | What you get |
|------|----------|--------------|
| **Desktop** | install the bundle, or `npm run tauri dev` | The full app: tray, global shortcut, elevated kill, native notifications |
| **Web** | `workbench serve` | The same backend over HTTP on `127.0.0.1:7788`, serving the built UI to your browser. Real processes, ports and cost ledger — not demo data. Read-only for machine state: no kill endpoint, no remote access |
| **Demo** | open the deployed landing page | Static sample data so the UI can be evaluated without installing anything |

The header badge always says which one you are looking at — `Live`, `Web · live data`
or `Demo` — so a number on screen is never ambiguous about being real.

## Screenshots

| Overview | Processes |
|----------|-----------|
| ![Overview](docs/screenshots/01-overview.png) | ![Processes](docs/screenshots/02-processes.png) |
| CPU / memory trends, disks, process groups | Full snapshot, virtual scrolling, CSV export |

| Process tree | Command palette |
|--------------|-----------------|
| ![Process tree](docs/screenshots/17-process-tree.png) | ![Command palette](docs/screenshots/18-command-palette.png) |
| Parent/child grouping with per-process ports | Ctrl/Cmd+K across pages, processes, ports, projects, tasks |

| Servers & ports | AI sessions |
|-----------------|--------------|
| ![Servers](docs/screenshots/03-servers.png) | ![AI sessions](docs/screenshots/04-ai-sessions.png) |
| netstat / ss parsing, dev-framework tags | Session files, live sessions, tool mix |

| Cost ledger | Tasks |
|-------------|-------|
| ![Costs](docs/screenshots/05-costs.png) | ![Tasks](docs/screenshots/08-tasks.png) |
| Budget progress, trend, model split | Drag-and-drop kanban |

### Visual 2.0 — themes, effects, personalization

| Ambient particles | Custom background |
|-------------------|-------------------|
| ![Particles](docs/screenshots/19-particles.png) | ![Background](docs/screenshots/20-background.png) |
| Theme-colored drifting particles, 0–100 intensity | Any local wallpaper under a readability veil, stored on-device |

| First-run tour | Empty-state art |
|----------------|-----------------|
| ![Onboarding](docs/screenshots/22-onboarding.png) | ![Empty art](docs/screenshots/21-empty-art.png) |
| 3 steps: features → 16 themes → motion level | Shared illustration across every empty view |

| Midnight (dark) | Midnight Aurora (glass) |
|-----------------|-------------------------|
| ![Dark](docs/screenshots/23-dark-overview.png) | ![Glass](docs/screenshots/24-glass-aurora.png) |
| 16 built-in themes, 4 dark + 4 light + … | Glass material with per-theme ambient glow |

### 30-second tour

[![Demo](docs/screenshots/01-overview.png)](docs/screenshots/workbench-demo.mp4)

Recorded from the real UI in browser demo mode (no real host, path or account
data appears in it). [Download the MP4](docs/screenshots/workbench-demo.mp4).

## Features

| Feature | What you get |
|---------|--------------|
| **Monitoring** | Live processes, listening ports (`netstat` on Windows, `ss -tulpn` on Linux with a netstat fallback) and dev-server detection with framework + confidence |
| **Process tree** | Flat table or parent/child tree from `parent_pid`; orphan and cycle-safe, virtual scrolling, per-row detail with the process's own listening ports, CSV export |
| **Command palette** | Ctrl/Cmd+K fuzzy search over pages, processes, ports, projects and tasks; keyboard navigation with ↑ ↓ ↵ Esc |
| **Elevated kill** | "End as administrator" retry after a normal kill fails — triggers the OS UAC prompt; protected system processes are rejected by the backend before any prompt appears |
| **AI cost metering** | Token costs of local Claude / Codex sessions in a SQLite ledger — no model, no API key, nothing leaves your machine |
| **Pricing editor** | 40+ built-in model prices; edit / add / reset overrides from the UI |
| **Backup & restore** | Timestamped snapshots with one-click rollback and integrity checks (`VACUUM INTO` + `PRAGMA integrity_check`) |
| **Start at login** | Real OS registration (registry / autostart entry), toggle reads back from the OS |
| **Environment check** | Per-item ok / warn / fail report for platform, data directory, cost DB, session folders and port tools, with a copyable summary |
| **CLI mode** | One binary, four read-only commands: `ps`, `ports`, `diag`, `cost` (all support `--json`). Scriptable, no window |
| **Web mode** | `workbench serve` starts the same backend over HTTP and serves the built UI to a browser on the same machine — real process/port/cost data, not a demo |
| **Visual system** | 7 overview layouts × 8 themes × 3 shells, draggable & hideable widgets with per-widget widths, theme editor with share links |
| **Trilingual UI** | 简体中文 (default) / English / 日本語 |
| **Cross-platform** | CI defines Windows, Linux and macOS jobs, including Linux `.deb` and macOS `.app` builds |

## Quality gates

Nothing in this repo is claimed without a command that proves it. The same
steps run locally (`node scripts/ci-local.mjs`) and in CI:

| Gate | What it catches |
|------|-----------------|
| `npm run version:check` | the four version files drifting apart |
| `npx tsc --noEmit` | type errors, including the generated IPC contract |
| `npm run lint` · `npm run format:check` | zero-warning ESLint, Prettier |
| `npm run dup` | duplicated code above 3 % |
| `npm run coverage` | 532 frontend tests with an enforced threshold |
| `cargo test` | 161 backend tests, plus the ts-rs binding export |
| `cargo clippy -- -D warnings` | Rust lints, zero tolerated |
| `npm audit` · `cargo audit` | known vulnerabilities in either dependency tree |
| `npm run test:e2e` | 28 Playwright cases: structure, WCAG AA contrast, visual baselines |

## Download

Check the release pages for available versions and assets. The release workflow
is configured to build Windows NSIS, Linux `.deb` and macOS `.app` bundles;
this does not establish that assets were published or verified on every platform.

Release pages:

| Mirror | Releases |
|--------|----------|
| GitCode | [gitcode.com/badhope/workbench/releases](https://gitcode.com/badhope/workbench/releases) |
| Gitee | [gitee.com/badhope/workbench/releases](https://gitee.com/badhope/workbench/releases) |
| GitHub | [github.com/X33834/workbench/releases](https://github.com/X33834/workbench/releases) |

## Build

Requires Node.js `^22.22.2 || ^24.15.0 || >=26.0.0` for the locked frontend dependencies and Rust ≥ 1.90:

```bash
npm install
npm run tauri dev      # desktop dev mode (hot reload)
npm run tauri build    # installers → src-tauri/target/release/bundle/
```

Local CI mirror (same steps as `.github/workflows/ci.yml`):

```bash
node scripts/ci-local.mjs          # typecheck → lint → format → unit → build → Playwright → cargo
node scripts/ci-local.mjs --fast   # skip the visual-regression pass
```

Command line (same executable, no window):

```bash
workbench ps              # every process: pid, name, cpu%, memory, parent, status
workbench ports           # listening TCP/UDP ports with the owning PID
workbench diag            # environment self-check
workbench cost            # AI session cost summary (--days N, --by-project)
workbench serve           # headless HTTP API + web UI on 127.0.0.1:7788
workbench ports --json    # machine-readable output for scripts
```

Tech stack, project structure, FAQ, screenshots and everything else live in
the [architecture & reference doc](docs/ARCHITECTURE.md)
([简体中文](docs/ARCHITECTURE.zh-CN.md) / [日本語](docs/ARCHITECTURE.ja.md)).
What ships next — and what is deliberately refused — is in
[ROADMAP.md](docs/ROADMAP.md). How this compares with Mission Center, System
Informer, btop++, Glances, ccusage and friends:
[docs/COMPARISON.md](docs/COMPARISON.md).

## Contributing & License

- Contribution workflow: [CONTRIBUTING.md](CONTRIBUTING.md) · Security:
  [SECURITY.md](SECURITY.md) · Conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) ·
  Changelog: [CHANGELOG.md](CHANGELOG.md)
- [MIT](LICENSE) © 2026 x1882
