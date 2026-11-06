# How Workbench compares

A honest comparison with the tools people usually evaluate alongside Workbench.
Feature claims below were taken from each project's own documentation in
October 2026; links are in the table. Workbench's own column describes this
repository, not an aspiration.

## Feature matrix

● yes · ◐ partial / indirect · ○ no

| | Workbench | [Mission Center](https://gitlab.com/mission-center-devs/mission-center) | [System Informer](https://systeminformer.com/) | [btop++](https://github.com/aristocratos/btop) | [Glances](https://github.com/nicolargo/glances) | [Stats](https://github.com/exelban/stats) | [ccusage](https://ccusage.com/) | [Claude Code Usage Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) |
|---|---|---|---|---|---|---|---|---|
| Process table | ● | ● | ● | ● | ● | ◐ | ○ | ○ |
| Process tree | ● | ● | ● | ● | ○ | ○ | ○ | ○ |
| Port → owning process | ● | ○ | ● | ○ | ◐ | ○ | ○ | ○ |
| Dev-server detection | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| Project registry + tasks | ● | ○ | ○ | ○ | ○ | ○ | ◐ | ○ |
| AI session cost ledger | ● | ○ | ○ | ○ | ○ | ○ | ● | ● |
| Budget alerts | ● | ○ | ○ | ○ | ○ | ○ | ○ | ● |
| Elevated process kill | ● | ○ | ● | ◐ | ◐ | ○ | ○ | ○ |
| Tray + start at login | ● | ○ | ● | ○ | ○ | ● | ○ | ○ |
| Theming beyond light/dark | ● | ◐ | ◐ | ● | ◐ | ◐ | ○ | ○ |
| i18n (3+ languages) | ● | ● | ○ | ○ | ○ | ● | ○ | ○ |
| Keyboard command palette | ● | ○ | ○ | ◐ | ○ | ○ | ◐ | ○ |
| CSV export | ● | ○ | ● | ◐ | ● | ○ | ● | ● |
| Browser/web mode | ● (live, local) | ○ | ○ | ○ | ● | ● | ○ | ○ |
| Scriptable CLI | ● | ○ | ◐ | ◐ | ● | ○ | ● | ● |
| Plugin / extension API | ○ | ○ | ● | ○ | ● | ○ | ◐ | ○ |
| Auto-update | ○ | ○ | ● | ○ | ◐ | ● | ○ | ○ |
| License | MIT | GPL-3.0 | MIT | Apache-2.0 | LGPL-3.0 | MIT | MIT | MIT |

## Where the others are better

Being specific matters more than claiming a win everywhere.

- **Mission Center** is deeper on *machine* telemetry than Workbench: per-thread
  CPU, GPU (NVTOP), fans, sensors, and an Apps page that aggregates child
  processes under their application while keeping the tree. It ships in 45
  languages via Weblate and is preinstalled on several Linux distributions.
  Workbench has no GPU or sensor page.
- **System Informer** is the reference for Windows process forensics: handles,
  DLLs, stack traces, services, a Network Stack view with "Go to Process", and
  a plugin API. Workbench shows far less per process and cannot inspect handles.
- **btop++** is the better *always-on* monitor: tiny footprint, mouse support,
  signal sending, and 41 theme files. Workbench is an app you open, not a TUI
  you leave running in a terminal pane.
- **Glances** wins on automation: a documented REST API, an MCP server, a
  client/server mode and CSV/JSON export. Workbench has no API or remote mode.
- **Stats** owns macOS menu-bar monitoring, with 13 menu-bar widgets and a
  privacy section that lists its two external APIs. Workbench's macOS build is
  CI-only and unsigned.
- **ccusage** covers 18 coding agents from a single CLI, with `--instances` per
  project. Workbench reads Claude Code and Codex session files only.
- **Claude Code Usage Monitor** predicts 5-hour block exhaustion and labels
  whether a number is `official` or `local_estimate`. Workbench reports measured
  / estimated / zero-pricing confidence per ledger row but does not forecast.

## Where Workbench is different

1. **One window joins three layers.** A listening port links to the process that
   owns it; the process detail lists every port it holds; the cost ledger ties
   spend to the session files that produced it. None of the tools above combine
   machine state with AI-session spend.
2. **It understands dev servers.** Vite, Next, Nuxt, Django, uvicorn, Rails and
   30+ more are recognised from the command line, with a confidence level, and
   surfaced as "dev servers" rather than raw ports.
3. **The safety story is implemented, not described.** Protected process lists
   live in Rust, the target identity is re-verified immediately before a kill,
   UAC elevation is per-action and off by default on other platforms, and the
   environment check reports what it actually verified.
4. **It is honest about what it cannot do.** No code signing, no auto-update, no
   plugin API, no remote monitoring. Those are listed as gaps in
   [ARCHITECTURE.md](ARCHITECTURE.md), not hidden.

## Choosing

| If you want… | Use |
|---|---|
| Deep Linux hardware telemetry | Mission Center |
| Windows process forensics | System Informer |
| A terminal monitor you leave running | btop++ or Glances |
| macOS menu-bar stats | Stats |
| Agent spend across many CLIs | ccusage |
| Claude-only quota forecasting | Claude Code Usage Monitor |
| Ports + dev servers + AI spend in one desktop app, with a real UI | Workbench |
