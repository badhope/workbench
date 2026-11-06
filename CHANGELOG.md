# Changelog

This project follows [Semantic Versioning](https://semver.org/) and the format
recommended by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.7.1] - 2026-11-07

### Fixed — 实机验收发现的两处「装完用不了」

按用户拿到安装包后的真实路径重验（静默安装 → 启动 → 逐页走查），发现并修复：

- **安装版 Web 模式页面 404**：安装目录只有一个 exe，没有 `dist/`；
  静态目录回落链的最后一条是 `CARGO_MANIFEST_DIR/../dist`——那是**构建机**
  的源码路径，用户机器上必然落空。实测把构建机 dist 移走后 `GET /` 返回 404
  （API 正常），Web 模式等于不可用。修复：前端产物编译期嵌入二进制
  （rust-embed，34 个文件，~1.3 MB），`workbench serve` 单文件自包含，
  拷走 exe 也能出完整页面；磁盘 dist 仍优先（开发时改前端不必重编 Rust）。
  `/api/*` 未命中保持 404 JSON，不会回落成 SPA HTML。
- **定价编辑器在浏览器模式下显示「需要桌面端」**：`PricingEditor` 的加载
  门禁写死 `isTauri()`，且 HTTP 侧根本没有定价端点。补 `GET/PUT
  /api/cost/pricing`（与桌面 IPC 共用同一份校验：任一条非法整体拒绝），
  门禁改为 `isBackend()`。实测 PUT 一条覆盖价 → 落盘 `pricing_overrides.json`
  → 读回一致。

### Verification

| Gate | Result |
|------|--------|
| 前端 | 532 tests，coverage 86.6% branches（阈值 85%） |
| 后端 | 163 tests（新增嵌入资源 MIME 覆盖与 SPA 回落门禁） |
| 实机 | 静默安装 → 移走构建机 dist → `GET /` 200 + 深链 200；定价 PUT→磁盘→读回一致；卸载器清目录与注册表 |
| 持久化 | UI 建项目/任务 → `data.json` 落盘 → 重启服务后仍在 |

## [0.7.0] - 2026-11-07

### Added — 第三种运行形态：浏览器 + 真实后端

- **`workbench serve`**：同一个可执行文件现在能当服务器用。`serve --port 7788
  --dist dist` 起 axum HTTP 服务，把进程、端口、开发服务器、AI 会话、成本账本
  以 REST 暴露给同机浏览器。默认只绑 `127.0.0.1`，没有账号、没有认证，也
  没有远程监控——它是「同一台机器换个界面」，不是多机方案。
- **前端三态传输**（`src/lib/transport.ts`）：启动时判定 `__TAURI_INTERNALS__`
  → IPC，`GET /api/health` 成功 → REST，都不满足 → 静态演示数据。顶栏与侧栏
  徽章显示「实时 / Web · 真实数据 / 演示」，用户永远不会看着假数据猜真假。
- **`workbench cost`**：成本账本终于有 CLI。`cost`（人读）、`--json`（含
  `schema` 与 `generated_at` 的稳定契约）、`--days N`、`--by-project`。
- **崩溃可见**：安装 panic hook，把消息与位置追加到 `crash.log`；环境自检页
  在存在崩溃记录时多出一条 warn，附最后一行摘要。桌面应用没有控制台，
  在此之前 panic 信息是彻底丢失的。

### Changed — 后端解耦，为三入口共用一套逻辑

- 新增 `paths::DataRoot`：数据目录解析从 `AppHandle` 剥离。`cost_store` /
  `data` 不再依赖 Tauri，桌面、CLI、HTTP 三条入口调用同一份实现。此前
  `cost_store.rs` 有 24 处 `AppHandle` 引用，是「无法脱离桌面壳运行」的
  唯一障碍。
- 新增 `runtime`：端口缓存、PID 索引、dev server 组装、AI 进程识别、
  opencode 端口发现从 IPC 命令层抽出，HTTP 与 IPC 共用，避免两套口径。
- `list_ai_processes`、`system_info`、`disk_info` 增加同步实现并在两处复用。

### Fixed

- **端口「打开」链接**：原先是硬编码 `http://localhost:PORT`，IPv6 监听、
  HTTPS 服务、UDP 端口全部给出错误地址。改为按实际监听地址与常见 TLS 端口
  推断，且 UDP 不再显示该按钮（没有可打开的语义）。
- **版本门禁在 Windows 上假红**：`check-version.mjs` 用 `
` 匹配 Cargo.lock，
  而 cargo 在 Windows 写 CRLF。现在先归一化行尾再匹配。
- 文档漂移：架构文档（en/zh/ja）此前写「没有 HTTP API」，与 0.7.0 的实现矛盾；
  COMPARISON 的「浏览器模式」从「演示」更正为「本地实时」。

### Notes

- Web 模式**不提供**结束进程、打开路径、清空成本库。这些不可逆操作需要可信的
  用户确认，浏览器里没有等价保证，因此留在桌面确认流程里。
- `--allow-origin` 只为「前端单独跑在 5173 端口」这类开发场景准备，默认不加
  CORS 层。

## [0.6.0] - 2026-11-04

### Added — 视觉 2.0（体验与个性化专项）

- **自定义背景图**：设置 → 外观可选择本地图片作为全局背景。导入链路全部
  在本机完成——等比压缩到最长边 1920px、JPEG 原样保留 / 其余重编码为
  PNG（canvas 画 GIF 只取首帧）、容量守卫 2.5MB，绝不联网。渲染时垫一层
  78% 主题底色遮罩，任何壁纸上文字都可读；清除一键还原。
- **空态插画**：共享 `Empty` 组件升级为「虚线托盘 + 悬浮盒」插画——语义
  图标嵌在盒面、光点取主题强调色、1.5px 缓浮动画（动效关档时静止）。
  进程无匹配、AI 进程、会话文件、采样空态、任务页等全站空态同步受益。
- **氛围粒子背景**：Canvas 2D 轻量粒子场（零依赖），跟随主题强调色取色、
  换主题自动重新上色。默认关闭；开启后仍受三重省电约束——页面隐藏自动
  暂停 rAF、动效档位「关」时同步停用、粒子数按窗口面积钳制在 24–72。
  设置 → 外观新增「氛围粒子」开关与 0–100 强度滑杆。

### Changed

- persist v4 → v6：新增 `particlesIntensity`（默认 65，钳制 0–100）与
  `backgroundImage`（默认 null，写入白名单只收 `data:image/*`，杜绝把
  存储 key 当 CSS 用的注入面）。迁移只补默认值，不覆盖用户已有设置。

- **动效系统（三档）**：设置页新增 动效强度 关/标准/丰富。视图切换走 View
  Transitions API（`@supports` + API 双守卫，不支持时瞬时切换）；统计数字
  count-up 滚动；骨架屏 shimmer；卡片 hover 抬升。全部只用
  transform/opacity（GPU 合成层），`html[data-motion]` 一处集中断闸；
  未显式选择时尊重系统 prefers-reduced-motion（自动降为关）。
- **卡片深度**：废除全局 `--shadow-card: none`。每主题可配 elevation
  0–3 求解出静态阴影与 hover 阴影两档，Mono Brutal/Terminal 等直角主题
  显式 elevation 0 保持粗野风。
- **渐变强调色**：`ThemeInput` 新增 `accent2`（缺省为 accent 色相 +36°，
  过与主色同一道 4.6:1 AA 求解）与 `gradientAccent` 开关（默认开）；
  统计卡数字与主按钮消费渐变，全部主题（含自定义）经求解器兜底。
- **主题库 8 → 16 套**：新增 4 暗（Midnight Aurora / Ember / Matcha /
  Grape Soda）与 4 亮（Nordic Light / Sakura / Mono Brutal / Sky），
  每套有性格（材质/氛围/层级各异），全部经 AA 求解器与 16 主题 e2e
  对比度门禁实测。
- **氛围强度**：glow 从「玻璃材质才有」改为 0–100 主题参数（玻璃默认
  55，Aurora 显式 60），亮色主题也可用低饱和光晕。
- **统计卡重做**：图标放进 accent 圆角底座、数字用渐变、hover 微反馈；
  组件 props 不变，调用方零改动。
- **首次启动引导**：3 步浮层（功能一览 → 16 主题即点即换 → 动效档位），
  完成/跳过/ESC 均记忆到 localStorage 永不再弹。旧版本（persist v3）
  升级后也会看到一次——这是有意行为：它同时是新版功能导览，一键可跳过。
- **持久化 v3 → v4**：只补默认值（motion=standard、motionExplicit=false、
  onboardingDone=false），自定义主题、组件摆放、布局全部保留（迁移有
  单测与 e2e 双重验证）。
- 新增 `scripts/shot_pages.mjs`：按主题 × 页面批量截图的自检工具，
  视觉改动前后人眼对比用。

e2e 基线已随本次变更整体重生成；16 套主题的 WCAG AA 对比度用 canvas
逐像素实测通过。

## [0.5.0] - 2026-11-03

### Added

- **Per-project cost attribution.** The dashboard answers "which repo costs the
  most" in one query: `project_breakdown_sql` groups the ledger by the session's
  project directory (`ProjectBreakdownRow`), ordered by spend, with a per-row
  bar and token counts. Estimated rows follow the same include-estimated switch
  as every other money view.
- **Ledger export.** New `get_cost_export` command returns the raw records
  (bounded at 200k rows, oldest first), and the cost page gains CSV and JSON
  export buttons. CSV reuses the RFC 4180 escaping and formula-injection guard
  from the process table (`src/lib/costExport.ts`), keeps full float precision,
  and includes estimated rows — `cost_source` is a column, so the file states
  what is measured and what is not.
- **Historical trend beyond 30 days.** `get_cost_trend_extended` returns the
  daily window plus monthly buckets (`CostMonthRow`) for everything older; the
  two ranges cannot overlap by construction, so the chart splices them into one
  line. A 14/30/90-day switcher lives in the trend card header.
- **Frontend diagnostics buffer.** `src/lib/diagnostics.ts` captures global
  `error` and `unhandledrejection` events — the ones an `ErrorBoundary` cannot
  see (event callbacks, timers, unawaited promises). The most recent 50 entries
  persist in `localStorage` with a short id (`E001`…), timestamp, kind, stack and
  the page where the error happened; identical consecutive messages are
  collapsed so a repeating chart cannot flood the buffer. Nothing leaves the
  device.
- **The error boundary now hands the user something to report.** A crash shows
  the message plus expandable stack details and a one-click copy (message +
  stack + UA) that pastes straight into an issue. Every render crash is also
  written into the diagnostics buffer.
- **Settings → Diagnostics shows frontend errors.** The panel previously could
  report "all checks passed" while the UI itself was broken; it now lists
  recorded frontend errors, offers a clear button, and appends them to the
  copyable report.
- **Log page filtering.** The logs page gains a keyword search, a level filter
  (all / error / warn / info / debug, parsed from the Rust tracing output) with
  per-level counts, and a shown/total line counter. Filtering happens in the
  render layer only — no extra file reads.

### Changed

- **The default theme is now the light Frost, not the dark Midnight.** The
  product targets developers staring at the screen in a lit office; dark stays
  a first-class citizen (four of the eight built-ins). `index.html` pins the
  three most visible tokens and syncs the saved theme's polarity before first
  paint, so light-theme users no longer get a dark flash on launch and dark
  users no longer get a light one.
- **Selected-state backgrounds are solved, not fixed-ratio.** `--color-accentsoft`
  was "panel mixed with 12–18 % accent" and was never checked against the
  accent text on top of it — Frost measured 4.45:1, just under AA. The mix ratio
  is now solved from the 4.6:1 target per theme, for built-ins and user themes
  alike, with a regression test over all eight built-ins.
- **The theme editor says when a color was adjusted.** When a chosen accent
  fails AA and the theme system will darken it on save, the row shows an
  "auto-adjusted" badge with the effective value in its tooltip — instead of
  silently saving a different color than the user picked.
- **The log pane uses theme-derived `panel2`** instead of a hardcoded
  `color-mix(bg 82%, black)`, which dropped timestamps to 4.02:1 on the new
  light default.
- **Budget alerts are acknowledged as shipped.** The OS notification path
  (`checkBudgetAlert` + permission request) has existed since 0.4.0; the
  roadmap wrongly listed it as open. Tests cover the notify-once-then-reset
  behaviour.

### Fixed

- **A half-finished edit to the logs page** (a string literal split across
  lines, an unimported `LogLevel` type and a missing `levelOf` helper) is
  completed as the feature it was meant to be; the filter UI the change had
  already prepared state and memos for is now actually rendered.
- **E2E custom-theme assertion** now checks that the accent keeps its hue and
  meets AA after the contrast solve, instead of asserting the raw input
  survives; visual baselines were regenerated for the light default and the new
  cost-page cards.

## [0.4.0] - 2026-11-02

### Added

- **Bounded session scanning with a real report.** Walking `~/.claude/projects`
  and `~/.codex/sessions` now enforces depth, entry, file-count, per-file byte,
  per-line byte and total-byte budgets, never follows symlinks or NTFS reparse
  points, and verifies that the file it opened is the file it inspected. Every
  skipped entry is reported as a `ScanIssue` instead of being dropped: the UI can
  now distinguish "no sessions" from "the scan gave up". `ScanLimits` and the
  `SessionScanReport` shape live in `src-tauri/src/ai.rs`.
- **Content fingerprints replace the (path, mtime, size) cache key.** Two scans of
  a file whose size and modification second did not change now produce a new
  fingerprint and replace the stored snapshot, so a same-size rewrite is no
  longer billed as stale. Parser and pricing generations are part of the key, and
  bumping either invalidates the whole incremental cache.
- **Pricing edits invalidate the ledger.** Saving an override now bumps a pricing
  generation and the cost dashboard rescans, so displayed totals follow the new
  prices instead of silently keeping the old ones.
- **Explicit restore path for user data.** `store.restore.test.ts` and
  `Settings.restore.test.tsx` cover refusal, confirmation and post-restore state;
  drafts survive navigation (`DraftPersistence.test.tsx`), and a rejected import
  no longer reports success.
- **`scripts/release-workflow.test.mjs`** asserts that the release workflow gates
  on tag/version consistency, non-empty artifacts and checksums.

### Changed

- **Malformed token values fail the file instead of counting as zero usage.**
  Previously an unparseable `usage` field was billed as 0, which silently
  under-reported spend. Token arithmetic is range-checked against SQLite's i64
  before it is written.
- **A 256 MiB read budget per scan** bounds total work. Files beyond the budget
  are reported as failures and keep their previous ledger rows, rather than
  truncating the scan into an apparent success.
- **README ×3 and the architecture docs** now state the actual toolchain
  (Node `^22.22.2 || ^24.15.0 || >=26.0.0`, Rust ≥ 1.90) and the real limits.
- **Visual baselines regenerated** for the three themes whose demo data changed;
  the suite is stable across consecutive runs.

### Fixed

- **The UI no longer shows a raw exception as an empty session list.** A read
  failure renders an error state with a retry action, and out-of-order refresh
  results are discarded instead of overwriting newer data.
- **`Settings.restore.test.tsx` "does not report imported when persistence
  rejects the import"** failed on the previous tree; the restore path now
  propagates the rejection.
- **The Chinese README carried a schema-migration note inside the feature
  introduction** where it did not belong; the note now lives in the version
  history and the introduction reads as a product page.

## [0.3.0] - 2026-10-24

### Added

- **Process tree view.** `parent_pid` now drives a real hierarchy: flat table or
  parent/child tree, cycle-safe and orphan-safe (`buildForest` promotes nodes
  that no natural root can reach instead of dropping or duplicating them),
  virtualised, and with a per-row detail panel that lists the ports *that*
  process is listening on. Sibling order follows the active sort key. Recorded
  in `src/pages/processes/tree.ts` with 9 unit tests.
- **Command palette (Ctrl/Cmd+K).** One fuzzy search over pages, processes,
  ports, projects and tasks; ↑ ↓ to move, ↵ to run, Esc to close. Selecting a
  process or port jumps to the process page, sets the query to that PID and
  highlights the row for a few seconds. Pure matching logic in
  `src/lib/commandSearch.ts` (7 tests), UI in `components/CommandPalette.tsx`.
- **Port → process jump, both directions.** Every listening port now has a
  "show owning process" action; the process detail lists the reverse mapping.
- **CSV export** for the process table and the listening-port list. Escaping is
  RFC 4180 plus formula-injection neutralisation (`= + - @` prefixed with an
  apostrophe), covered by `src/lib/export.test.ts`.
- **CLI mode.** The same executable now also works as a small read-only CLI:
  `workbench ps`, `workbench ports`, `workbench diag`, each accepting `--json`.
  No window opens and no state is written; killing processes deliberately stays
  in the GUI confirmation flow. Windows builds attach to the parent console or
  write the redirected handle, so `workbench ports --json > ports.json` works
  from cmd, PowerShell and Git Bash alike (verified on the packaged exe).
- **Environment self-check** in Settings (`diagnostics` command): platform, data
  directory writability, cost database, Claude / Codex / opencode session
  folders, and the port tooling actually used on this OS — each reported
  independently as ok / warn / fail with a hint and a copyable summary. One
  failing check never aborts the report.
- **Feature E2E suite** (`e2e/features.spec.ts`, 7 cases): command palette
  open/search/execute, process tree expand/collapse, port jump, CSV download
  contents.

### Changed

- **Process status is language-independent.** The Rust backend used to emit
  localized Chinese labels (`运行中`), so English and Japanese users saw Chinese
  in the status column. It now emits stable ASCII keys (`Run`, `Sleep`, …) and
  the UI translates them via `src/lib/processStatus.ts`, which also maps the
  legacy labels so old snapshots still render.
- **The resource chart follows the theme.** CPU/memory series were hard-coded
  cyan/amber; they now take the active theme's accent and warn colours, so Paper,
  Ink and custom themes stop growing foreign colours.
- **Pinned window state survives a restart.** `alwaysOnTop` was persisted but
  never re-applied to the window, so the pin icon lied after a relaunch.
- **Tree view defaults to one expanded level.** A fully collapsed tree looks
  like "only a handful of processes"; a fully expanded one floods a thousand
  rows. The first switch expands the roots and remembers the user's own set
  afterwards.
- **README ×3 rewritten** around positioning, the new capabilities and a real
  demo video; the landing page was brought in line (version, screenshot paths,
  new shots, video, platform FAQ).
- **New `docs/COMPARISON{,.zh-CN,.ja}.md`**: an honest feature matrix and
  "where the others are better" section against Mission Center, System
  Informer, btop++, Glances, Stats, ccusage and Claude Code Usage Monitor.

### Fixed

- **Landing page referenced four screenshots that never existed**
  (`05-projects.png`, `06-tasks.png`, `07-settings.png`, `08-logs.png`); the
  real files are `07-`, `08-`, `09-`, `10-`. The Pages workflow now fails when
  any `src`/`href` asset is missing, so this cannot silently rot again.
- **Landing page still advertised v0.1.1** and a filename that no longer exists.
- **Demo mode had no process hierarchy**, so the new tree view looked empty on
  first acquaintance; demo data now includes two root processes with children.
- **`README` listed Linux as "not packaged" for the current release** while CI
  builds a `.deb` on every push; CI now uploads `linux-deb` and `macos-app`
  artifacts and the README links to them instead of claiming they do not exist.

### Infrastructure

- `pages.yml` and `release.yml` restored (they had been deleted from the
  default branch by the mirror clean-up commits). Pages now validates every
  referenced asset; Release builds Windows NSIS, Linux deb and macOS app,
  publishes SHA-256 checksums and states plainly that the builds are unsigned.

## [0.2.0] - 2026-10-23

### Added

- **UAC-elevated process termination.** When a normal kill fails, the kill
  confirmation dialog offers an "End as administrator" retry that triggers the
  OS UAC prompt (`terminate_process_elevated`, single `u32` PID argument).
  The backend validates the target before spawning anything, so protected
  process lists (PID 0/4, csrss/lsass/services, the app itself) are rejected
  up front without ever flashing a UAC dialog.

- **Theme share links.** The appearance panel gained a "Share link" button next to export: it packs the current theme into the URL fragment (`#theme=…`, base64url of the same JSON the export button writes). Opening such a link imports the theme once at boot through the same fail-closed validator as the JSON import (id collisions are renamed, never overwritten) and strips the fragment from the address bar, so reloading cannot import twice. A payload that fails to decode or validate is dropped and the fragment is still cleared.
- **Two more overview layouts.** "Timeline" hangs every visible widget off one vertical rail as numbered stops, in the user's order. "Board" groups widgets into three fixed lanes (signals / resources / work) by purpose, keeps the user's order within each lane and drops empty lanes. Both ship with wireframe previews in Settings; the visual suite now covers seven layouts.

- **The cost ledger is now SQLite** (`cost.db`, `rusqlite` with the bundled
  amalgamation). Records are indexed by day / model / file, aggregation runs in
  SQL, and the scan writes incrementally inside one transaction. The old
  `cost_data.json` is imported once on first launch and renamed
  `cost_data.json.migrated` (never deleted) — a failed import leaves the file in
  place and retries next launch. Backups snapshot the database with
  `VACUUM INTO` (a plain file copy can catch a half-merged journal) and
  restoring validates `PRAGMA integrity_check` before touching live data and
  clears stale `-wal`/`-shm`/`-journal` sidecars. Measured: 100k records →
  overview + trend + breakdown in 246 ms.
- **Start at login**, backed by the real OS registration (`tauri-plugin-autostart`):
  HKCU\…\Run on Windows, a `.desktop` file under `~/.config/autostart` on
  Linux, a LaunchAgent on macOS. The toggle reads `is_enabled` from the OS on
  every mount instead of storing a local flag, so an entry removed in Task
  Manager shows as off. Browser preview renders a "desktop only" card and
  never calls IPC.
- **Inline page states**: `ErrorState` (role=alert, retry button), `Skeleton` /
  `SkeletonCard`, and `Empty.action`. Processes, Servers, Projects, Tasks, the
  cost dashboard and the overview widgets now show a skeleton on first load, an
  in-page error with retry on failure, and an actionable empty state, instead of
  four zeroed cards or a toast that disappears.
- **Theme editor** extracted from the settings page: colour fields, shape
  sliders (radius / grid / opacity), density-typeface-material groups and a live
  preview card. Editing a built-in theme now automatically duplicates it first
  (`editableTheme`) — previously the editor wrote a built-in id into the custom
  list, where `findTheme` kept returning the built-in and every edit looked like
  it did nothing.

### Changed

- **Themes are data now, not CSS.** A theme is six colours plus six shape knobs
  (card radius, button radius, density, typeface, material, grid strength,
  panel opacity, dark footing) expanded into 26 CSS variables and a matching
  chart palette. `src/lib/theme/tokens.ts` owns the derivation;
  `src/lib/theme/presets.ts` holds eight built-in themes — Midnight, Frost,
  Paper, Aurora, Terminal, **Ink**, **Void**, **Jade**. Built-ins and custom
  themes share one render path, so any built-in can be duplicated and edited.
- Settings gained a real appearance panel: theme editor with live preview,
  import/export of theme JSON (fail-closed validation, id collisions renamed),
  shell picker, layout picker and widget manager. Persist version 3 migrates
  `dark`/`light` to `midnight`/`frost` and cleans the new fields.
- **Shell** is now a real choice: left rail, top dock (navigation in the header,
  full-width canvas) or zen (icon strip + centred column). Previously
  `StyleDef.shell` only rounded the preview swatch in Settings and never
  affected the app.
- **Overview has seven layouts** over the same nine widget components: bento,
  ledger, orbit, dense, zen, timeline, board. The orbit layout keeps the yin-yang *structure*
  (one hub + a ring of satellites) without rotating cards or text — the hub
  carries the headline gauge.
- **Widgets can be reordered and hidden** from Settings or dragged directly on
  the overview page; order and visibility persist per device.

- **Charts load on demand.** ECharts (550 KB) used to sit in a shared chunk that
  every page imported; it now has its own `echarts` chunk behind a lazy `EChart`
  wrapper, so Settings / Logs / Projects never download it. Measured on the
  production build: first-contentful-paint 292 ms, chart chunk requested only
  after the overview paints.
- **The theme now drives more than colour.** The chart series palette is derived
  from the accent hue instead of a fixed purple/blue/pink list, so a paper or
  ink theme no longer grows purple charts. The editor exposes the three status
  colours (`ok` / `warn` / `danger`) that `parseTheme` always accepted but the UI
  never showed, prints a live WCAG contrast ratio next to every colour, and has
  an **UI scale** slider (85–120%) that scales the whole WebView, not just the
  handful of rem-based sizes.
- **Widget widths are editable.** `widgetSpans` stores per-widget overrides
  (4/6/8/12 columns) with a picker in Settings; bento and ledger honour them.
  Previously "custom layout" only meant order and visibility.
- **Three gaps that only a real desktop could test are now scripted.**
  `scripts/e2e-agent.mjs` starts a local OpenAI-compatible mock (no real key, no
  cost) and drives the whole path: provider config → model asks for a mutating
  tool → step enters approval → approve → the tool really writes to `data.json`
  → the same approval token is rejected on replay → tool result goes back to
  the model. `scripts/e2e-io.mjs` feeds the hidden file input directly and
  checks that malformed JSON is rejected whole, a valid import lands, and the
  exported file can be imported again. `.github/workflows/ci.yml` gained a
  `Backend (macOS)` job that runs fmt / test / clippy and builds the `.app`.
- **Two more quality gates, both measured rather than asserted**: `npm run dup`
  runs jscpd at a 3% threshold (measured: **0.26%**, 5 clones / 49 lines), and
  `sonarjs/cognitive-complexity` is now an ESLint error at 15 (measured: **0
  functions over the limit**). Both run in `ci.yml` and in `ci-local.mjs`.
- **`node scripts/ci-local.mjs`** runs the same steps as `ci.yml` on this
  machine (icon contract, typecheck, lint, format, unit, build, Playwright,
  cargo fmt/test/clippy, IPC drift), so the remote run is a confirmation rather
  than a discovery. `--linux` tries the Linux job in Docker and says plainly
  when it cannot.
- **Complexity pass**: every function in `src/` is now at or below cyclomatic
  complexity 10 (was: `App` 43, `CostDashboard` 32, `parseTheme` 22,
  `buildTheme` 19, `Processes` 14, `Agent` 17). Extracted modules:
  `useAppRuntime`, `useShellLayout`, `pages/processFilter`, `pages/processes/
  ProcessTable`, `pages/servers/DevServerList`, `pages/ai/costCharts`.

### Removed

- **Agent conversation module** (AI chat + tool approval execution). Its 13
  tools fully duplicated features the dedicated pages already cover, and it
  required users to configure their own API key. AI session cost metering is
  unaffected — it reads local session files and never depended on the agent.

### Fixed

- **Density never applied.** `--space-card` had five values but 23 of 39 cards
  set `p-4` explicitly, and Tailwind's utilities layer beat the unlayered
  `.t-card` rule — every theme rendered 16 px padding. The padding rule moved
  into `@layer components` and the redundant classes were removed; measured
  Midnight 16 px vs Terminal 12 px afterwards.
- **Pie chart seams were the page colour, not the panel colour.** On light
  themes the card is white while the page is off-white, so every gap between
  sectors showed a grey line. `chartGapColor()` now returns the panel colour.
- **The visual baseline used pink masks.** Timestamps were masked with
  `toHaveScreenshot({ mask })`, which paints a solid magenta block into the
  baseline; the real layout underneath was never captured. Switched to
  `visibility:hidden`, and the clock is frozen (`page.clock.install`) so a
  screenshot is reproducible — before this, the first run failed and a rerun
  passed.
- Four dead i18n keys (`settings.dark` / `light` / `styleHint` /
  `appearanceHint`) had no references anywhere; removed.
- **`readableOn` mixed the wrong way.** It blended the text colour towards the
  background, which lowers contrast monotonically — on light themes it never
  reached the 4.5:1 target and silently returned the original 2.78:1 grey. It
  now solves towards black/white first and only then fades back, with a test
  that asserts the measured ratio.
- **README claimed the pricing overrides file was read-only** in all three
  languages, two releases after the in-app editor shipped. Corrected, together
  with the claim that Linux port collection was Windows-only.

### Added

- **Restore from backup.** `list_backups` / `restore_backup` join the existing
  `backup_data`. Restore validates every file as parseable JSON *before*
  touching anything, creates a safety backup of the current state, then replaces
  files atomically. The backup id is a timestamp, never a path, so traversal is
  rejected. Verified on the packaged exe: change data after a backup, restore,
  data is back; both the source and safety backups exist afterwards.
- Settings gained a Backup & restore panel listing every backup point with its
  timestamp and file list, plus a layout wireframe so the five overview layouts
  are distinguishable before clicking them.

### Fixed

- **Backups could overwrite themselves.** Directory names are second-precision,
  and restore creates a safety backup in the same second as the source it is
  restoring from — both landed in the same folder, so restore silently did
  nothing and destroyed the backup it was reading. Now the directory is claimed
  atomically and a collision waits for the next second.
- Restore now validates the source backup before creating the safety backup, so
  a corrupt backup no longer leaves a useless rollback point behind.
- The appearance panel's two cards were stretched to equal height by the grid,
  leaving a large blank area under the shorter one; the layout picker now shows
  a wireframe preview and the grid uses `items-start`.

- **Model pricing editor** (Cost ledger page). The built-in price table (56
  models, USD per 1M tokens) is listed with search; any model can be
  overridden, new models can be added, and each row can be reset to the
  built-in price. Saving is **whole-table validated**: one invalid entry rejects
  the entire write and shows every reason, because a partially applied price
  table makes the UI and the disk disagree. Invalid entries already sitting in
  `pricing_overrides.json` are now reported instead of being silently ignored.
  Two new IPC commands (`get_pricing` / `save_pricing`) with ts-rs generated
  types.
- **Real desktop E2E** (`scripts/e2e-desktop.mjs`): connects to the packaged exe
  over the WebView2 debugging port and exercises the real Tauri commands —
  pricing read/write/reject/reset plus UI rendering. This is the first test that
  runs against real IPC rather than the browser demo build.

### Fixed

- **Dev-server detection flagged dozens of false positives.** The `serve`
  rule was a substring match and `server` contains `serve`, so on this machine
  42 node processes (`dist-server/server/main.js`, `apps/server/main.js`) were
  reported as dev servers. Short words now require a standalone command token,
  plus a `node_modules/serve/` path check. Real run: 42 → 29.
- **A daemon was counted as a dev server.** `opencode-cli.exe serve --service`
  is opencode's own local API, not a user project. Commands carrying
  `--service` / `--daemon` / `--background` are excluded; the real machine now
  reports 29 entries, all genuine `vite` / `uvicorn` processes.
- Removed two unused theme variables (`--toward-light` / `--toward-dark`).
- Added the two missing i18n keys (`settings.widgetsShow` / `widgetsHide`) that
  the widget manager already referenced — they were rendering the raw key.


- **Design language rebuilt around "precision instrument"**, benchmarked against
  Apple / Tesla / Qoder / Linear / Vercel / Raycast / Stripe style modern product
  sites (see `docs/design-references.md`). Concretely:
  - Sidebar: 212 px rail, 32 px rows, active state = 2 px signal line + 8 % tint
    instead of a filled pill; brand block is a 52 px bar with a 1px hairline.
  - Header: 52 px, floating icon cluster (refresh / pin / theme) inside a pill,
    monospace timestamp, status chip with a live dot.
  - Cards: surface + 1px inner hairline + a 3.5 % top light wash. Removed the
    coloured top bars, the 32 px icon tiles and the heavy shadows from every
    stat card; numbers are now tabular monospace at 26–30 px and carry the card.
  - Overview opens with a masthead (mark + title + live state) directly on the
    canvas instead of a hero card with blurred blobs; machine info became a
    one-line nameplate; a 64 px grid field sits under the content.
  - Typography: 13 px base, 12 px section titles, 10 px tabular column heads,
    tighter heading tracking; all-caps was removed from section titles (it now
    only marks table column headers, where it is actually meaningful).
- **Chinese is the default UI language.** English and Japanese remain available
  in Settings; an explicitly stored choice is never overridden.

### Fixed

- **Logo no longer shows a white patch.** The sidebar and the overview masthead
  now render `BrandMark`, a pure-vector mark (four strokes, `currentColor`, no
  plate, no rect, no bitmap) — it sits directly on whatever surface is behind it.
  The app icon pipeline was rewritten to derive alpha from luminance instead of
  applying an estimated rounded-rect mask, which left a white ring wherever the
  mask radius disagreed with the badge radius. `scripts/check_icons.py` now also
  fails on any near-white visible pixel, not just opaque corners.
- Chart palette, `data-theme` swatches and the chart gap colour were re-based on
  the new surface colours, so Frost/Paper pies no longer draw black seams.

### Added

- **Five visual styles** switchable in Settings, each with a live preview card:
  - *Midnight* — dense dark console (the previous look)
  - *Frost* — light, airy, large radii, soft shadows
  - *Paper* — warm paper background, serif headings, wide margins
  - *Aurora* — translucent glass panels over a fixed gradient
  - *Terminal* — monospace, sharp corners, high contrast

  These change corner radius, shadow, spacing, type family and panel opacity,
  not just hue. Chart colours follow the style's light/dark footing
  automatically.
- **Visual regression tests** (Playwright): 11 baselines across five styles and
  key pages, plus structural assertions on theme variables. Added because
  overlapping chart labels, a collapsed hero column and an entirely blank
  settings page all passed the unit tests.
- **AI assistant with real tool calling** — talk to an OpenAI-compatible model
  that can call the workbench's own tools: inspect processes, ports, dev
  servers, AI sessions and cost, then act (create tasks, rescan costs, open a
  project directory, terminate a process). Every tool call is shown with its
  raw arguments so the user can audit it.
  - Mutating tools require a **per-call approval**. The backend stores the
    pending call (tool name + arguments) and executes that exact call once
    approved, so what the user approves is what runs. Approvals expire after
    5 minutes and cannot be replayed. The gate constrains the *model*; it is
    not a defense against a compromised WebView, which can already call
    `terminate_process` directly.
  - **Automatic failover**: primary service queued, timed out or reporting "no
    available channel" → the assistant switches to the configured fallbacks.
  - API keys are kept in process memory only — never written to disk, logs or
    config files.
- **Linux support** — port collection via `ss -tulpn` (with `netstat`
  fallback), unified listen-state vocabulary across both dialects,
  platform-aware protected-process lists, and a single normalisation rule that
  follows the path's own shape (drive letter, UNC, POSIX) instead of the
  compile target, so the same config string means the same thing on both
  platforms.
  **Verified on real Linux (Ubuntu 24.04)**: 93 unit tests pass, clippy is
  clean, the `deb` package builds (`Workbench_0.1.1_amd64.deb`, 8.2 MiB), the
  binary inside it has zero missing shared libraries, and it starts under
  Xvfb — the log shows the app booting and probing the opencode port.
  AppImage is not shipped: the bundler downloads `linuxdeploy` from GitHub at
  build time and that host is unreachable here, so it is unverified.
- **Responsive shell** — grouped, collapsible sidebar; on narrow windows it
  becomes a drawer. Layout adapts across desktop / tablet / phone widths.
- New **Cost ledger** page (cost moved out of the AI sessions page) and
  **Assistant** page.

### Changed

- Cost metering now reads the model from where the tools actually write it
  (`message.model` for Claude Code, `turn_context.payload.model` for Codex) and
  aggregates **per day and per model**, so a session that mixes models is priced
  correctly instead of applying the first model's rate to the whole file.
- Process snapshots are shared within a refresh cycle; port sampling is cached
  for the same window; system info no longer re-enumerates every process.
- Refresh requests are never dropped: concurrent callers share the in-flight
  sample and one follow-up runs afterwards.
- Polling pauses when the window is hidden.

### Fixed

- Windows drive paths (for example `C:/proj`) were misdetected as URL schemes,
  breaking every "open directory" action.
- Focus trap in dialogs could be escaped by clicking non-focusable body text.
- UNC paths collapsed into relative paths in the allowed-directory set.
- `updateCostSettings` reported success on failure, so unsaved settings looked
  saved.
- Modal/confirm dialogs: real focus trapping, ESC handling, focus restoration.
- Log rotation now happens at runtime (not only at startup) and tail reads no
  longer corrupt multibyte characters at chunk boundaries.
- Cost commands no longer block the main thread.

## [0.1.1] - 2026-10-12

### Added

- **Trilingual UI** — the whole frontend ships in English (default), 简体中文
  and 日本語, switchable in Settings and persisted per device
- Landing page internationalization (English default with a language switcher)

### Changed

- Dependency refresh (verified by the full local gate suite):
  - React / react-dom / @types/react / @types/react-dom → **19.3.0**
    (supersedes Dependabot #11 / #14, which half-upgraded and broke `npm ci`)
  - lucide-react → 1.54.0 (#10), vite → 8.3.4 (#44), @vitejs/plugin-react → 6.1.2 (#47)
  - reqwest → 0.13.5 (#8), sysinfo → 0.39.6 (#7), ts-rs → 12.0.1 (#9)
    (ts-rs API migration: `export_all_to(dir)` → `Config` + `export_all(&cfg)`;
    regenerated contracts are byte-identical)
  - GitHub Actions: checkout v7, setup-node v7, upload-artifact v7,
    action-gh-release v3
- TypeScript intentionally stays on 5.9.x: typescript-eslint does not support
  TS 7 yet (typescript-eslint#10940) — #13 closed with this reason
- README rewritten in English as the primary language, with README.zh-CN.md and
  README.ja.md kept in sync

## [0.1.0] - 2026-10-12

First public release. Windows desktop, NSIS installer.

### Added

- **Overview**: live CPU / memory trend charts, disk usage donut, process group
  stats, hero status banner
- **Processes**: full process snapshot, CPU / memory sorting and filtering,
  virtual scrolling (with variable-height expanded rows), kill confirmation,
  AI agent process detection
- **Servers & ports**: `netstat` listener detection, 30+ dev-framework tags
  (Vite / Next / uvicorn …), port-range distribution chart
- **AI sessions**: opencode online session list and detail, local Claude Code /
  Codex session file preview
- **Cost metering**: token usage stats, daily trends (last 14 days), per-model
  breakdown, budget alerts (system notifications), Anthropic cache pricing
- **Projects & tasks**: local project registry (automatic Git branch
  detection), kanban task board (drag to change status)
- **Logs**: built-in log viewer, tail reading, auto refresh and scroll follow
- **Settings**: theme / refresh interval, budget and alert thresholds, JSON
  data import & export
- **Desktop behavior**: close-to-tray, global hotkey `Ctrl+Shift+W`, always on
  top, per-launch log rotation

### Technical

- Tauri 2 + React 18 + TypeScript (strict) + Vite 6
- Zustand 5 (persist), Tailwind CSS 4 dual theme, ECharts 6 (tree-shaken)
- IPC contracts generated from Rust structs via ts-rs into `src/generated/`,
  drift-checked in CI
- Pure Rust logic (netstat parsing, framework detection, price matching, token
  extraction, JSON storage, IPC guard) unit-tested — 44 tests
- Frontend vitest suite — 48 tests

### Security

- Minimal WebView permission set; no `opener:allow-open-path` — opening
  directories goes through a whitelisted backend command
- IPC argument whitelist (directories / ports); session id charset & length
  validation
- CSP tightened to `self`; external requests never follow redirects
- Atomic writes for data files; corrupted files are preserved before erroring
- Process termination refuses PID 0/4 and critical system processes

### Known limitations

- Windows-only verified; macOS / Linux collection & packaging not wired up
- `pricing_overrides.json` is read-only, no UI editor
- The cost ledger lives in a single JSON file; very large histories make full
  read/write sluggish
- Installer is not code-signed; Windows may warn "Unknown publisher"

[0.1.1]: https://github.com/X33834/workbench/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/X33834/workbench/releases/tag/v0.1.0
