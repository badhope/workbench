# Roadmap

Workbench ships in small, verifiable increments. Every entry below states what
is done, what is next, and what is explicitly **not** planned — a roadmap that
only lists ambitions is a wish list, not a plan.

Current version: **0.9.8** · Status legend: ✅ shipped · 🚧 in progress · ⬜ planned

## 0.4.0 — Integrity of the numbers (shipped 2026-11-02)

| Item | Status | Evidence |
|------|--------|----------|
| Bounded session scanning with reported issues | ✅ | `src-tauri/src/ai.rs`, 131 backend tests |
| Content fingerprints replace mtime/size cache key | ✅ | `session_meter.rs`, ledger reconciliation tests |
| Pricing edits invalidate the ledger | ✅ | `CostDashboard.test.tsx`, `commands.rs` |
| Explicit restore path with rejection handling | ✅ | `store.restore.test.ts`, `Settings.restore.test.tsx` |
| Single `main` branch, version gate in CI | ✅ | `scripts/check-version.mjs`, `.github/workflows/ci.yml` |

## 0.5.0 — Depth on the cost side (shipped 2026-11-03)

| Item | Status | Evidence |
|------|--------|----------|
| Per-project cost attribution | ✅ | `cost_store.rs` `project_breakdown_sql`, `ProjectBreakdownRow`; dashboard card |
| Budget alerts that actually fire | ✅ | `store.ts` `checkBudgetAlert` — OS notification via `ensureNotificationPermission` + `notify`, once per crossing |
| Export the ledger | ✅ | `get_cost_export` command, `src/lib/costExport.ts` (RFC 4180 escaping via `csvCell`), CSV + JSON |
| Historical trend beyond 30 days | ✅ | `get_cost_trend_extended`: daily window + monthly buckets (`CostMonthRow`), no overlap by construction |

## 0.6.0 — Visual system and personalization (shipped 2026-11-04)

| Item | Status | Evidence |
|------|--------|----------|
| Theme library 8 → 16 with light default | ✅ | `src/lib/theme/presets.ts`, contrast suite across 16 themes |
| Custom background image (local only, 2.5 MB guard, readability veil) | ✅ | `AppearancePanel`, `image.ts` downscale/encode |
| Ambient particles, motion levels, elevation scale | ✅ | `ParticleBackdrop`, `applyMotion`, `[data-motion="off"]` single kill-switch |
| First-run tour and shared empty-state art | ✅ | `OnboardingOverlay`, `Empty` component |

## 0.7.0 — A third way to run it (shipped 2026-11-06)

| Item | Status | Evidence |
|------|--------|----------|
| `workbench serve` — HTTP API + static UI on loopback | ✅ | `src-tauri/src/server.rs`, 12 route-level tests (`server::http_tests`) |
| Backend decoupled from the desktop shell | ✅ | `paths::DataRoot` replaces 24 `AppHandle` references in `cost_store`/`data`; `runtime.rs` shared by IPC and HTTP |
| Frontend transport detection (IPC / REST / demo) with a visible badge | ✅ | `src/lib/transport.ts` + 13 tests, header and sidebar badges |
| `workbench cost` CLI (`--json` with schema, `--days`, `--by-project`) | ✅ | `cli.rs` `run_cost`, `cost_text` test |
| Crash visibility: panic hook → `crash.log`, surfaced in diagnostics | ✅ | `logging_setup::install_panic_hook`, `diagnostics::crash_log_check` |
| Theme-aware overlay scrim (was 55% black in light themes) | ✅ | `.overlay-scrim` in `global.css` driven by `data-chart-theme` |

## 0.9.x — Local memory + controlled AI writes (shipped 2026-11-19)

| Item | Status | Evidence |
|------|--------|----------|
| Local Markdown knowledge base with rebuildable FTS5 index | ✅ | `knowledge.rs`, `Knowledge.test.tsx`; files stay in place |
| Read-only MCP: context, search, read, status | ✅ | `mcp.rs`, protocol smoke; `#[tool_handler]` regression |
| Controlled writes: create/update task, append note | ✅ | `services/ai.rs`; 3 harness tests incl. traversal + symlink escape |
| Writes off by default, audited, undoable | ✅ | `ai.json` / `ai_actions.json`; Settings AI card; `AiAccessCard.test.tsx` |

## 0.9.8 — Locale polish: plurals and dates (shipped 2026-11-20)

| Item | Status | Evidence |
|------|--------|----------|
| `Intl.PluralRules` for English | ✅ | `src/lib/i18n/index.ts` selects current-language `.one` / `.other`; 18 English noun keys have variants |
| Locale-correct dates and byte units | ✅ | `formatDateTime` + `Intl.NumberFormat` in `src/lib/util.ts`; process detail, knowledge, diagnostics use it |

## 0.9.7 — Process columns, remembered (shipped 2026-11-20)

| Item | Status | Evidence |
|------|--------|----------|
| Column show/hide/reorder, persisted | ✅ | `src/lib/procColumns.ts`, `ColumnsMenu.tsx`; store v9 migration; 631 frontend tests |

## 0.9.6 — Next pass: ports, budgets, a11y (shipped 2026-11-20)

| Item | Status | Evidence |
|------|--------|----------|
| Port table: UDP + ESTABLISHED + remote address, state-change highlight | ✅ | `PortGrid.tsx` remote/state rows + `port-state-flash`; `Servers.tsx` connection card |
| Budget threshold lines on the cost trend | ✅ | `costCharts.ts` `BudgetLine`, `MarkLineComponent` registered in `echartsImpl.tsx` |
| Accessibility: `aria-sort` on sortable headers, `scope` on cells | ✅ | `ProcessTable.tsx` all `th` have `scope="col"`; sortable headers expose `aria-sort` |

## 0.9.4–0.9.5 — Visual coverage (shipped 2026-11-20)

| Item | Status | Evidence |
|------|--------|----------|
| Today live pulse with interactive CPU/memory sparkline | ✅ | `src/pages/today/LivePulse.tsx`, `Today.live.test.tsx` |
| Project portfolio pulse and Top-project drill-down | ✅ | `src/pages/projects/PortfolioPulse.tsx` |
| Knowledge pulse + demo index for static preview | ✅ | `src/pages/knowledge/KnowledgePulse.tsx`, `knowledgeDemo.ts` |
| Log severity pulse with dynamic counts | ✅ | `src/pages/logs/LogPulse.tsx` |
| Shared stat/distribution primitives | ✅ | `src/components/live/StatStrip.tsx`; 623 frontend tests, build passes |

## 0.8.0 — Reach (planned)

| Item | Status | Notes |
|------|--------|-------|
| Signed Windows installer | ⬜ | Blocked on a code-signing certificate; until then SmartScreen will warn and the release notes say so |
| Auto-update | ⬜ | Only meaningful after signing |
| Linux AppImage | ⬜ | `.deb` ships today; AppImage needs a bundled WebKitGTK or a documented runtime requirement |
| Homebrew tap | ⬜ | Needs a notarised macOS build first |

## Next

All unblocked Next items are shipped. `0.8.0 Reach` remains blocked on the signing
certificate and macOS build environment; no other planned item is open.

## Not planned

Being explicit about refusals is part of the design:

- **Cloud sync or accounts.** The product's premise is that data never leaves
  the machine. A hosted tier would invalidate the security model, not extend it.
- **Remote machine monitoring.** Same reason: it requires an agent and a
  network path. Use a real monitoring system for that.
- **Telemetry.** No analytics, no crash reporting. Diagnostics are local and
  user-initiated.
- **Bundling a model or an API key.** Cost metering reads local session files;
  it never calls a model.

## How a release happens

1. Work lands on `main` through short-lived branches (see
   [CONTRIBUTING.md](../CONTRIBUTING.md)).
2. `CHANGELOG.md` gains an entry under `Unreleased`.
3. The version is bumped in all four places; `npm run version:check` proves it.
4. A `vX.Y.Z` tag is pushed. The release workflow refuses to build if the tag
   disagrees with the version, builds Windows / Linux / macOS artifacts, and
   publishes SHA-256 checksums.
5. Unsigned builds are labelled as unsigned in the release body — never
   presented as verified.

## Where to look for detail

- [ARCHITECTURE.md](ARCHITECTURE.md) — module boundaries, data flow, IPC contract
- [COMPARISON.md](COMPARISON.md) — honest feature matrix against similar tools
- [CHANGELOG.md](../CHANGELOG.md) — every released change, with reasons
