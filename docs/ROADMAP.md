# Roadmap

Workbench ships in small, verifiable increments. Every entry below states what
is done, what is next, and what is explicitly **not** planned — a roadmap that
only lists ambitions is a wish list, not a plan.

Current version: **0.4.0** · Status legend: ✅ shipped · 🚧 in progress · ⬜ planned

## 0.4.0 — Integrity of the numbers (shipped 2026-11-02)

| Item | Status | Evidence |
|------|--------|----------|
| Bounded session scanning with reported issues | ✅ | `src-tauri/src/ai.rs`, 131 backend tests |
| Content fingerprints replace mtime/size cache key | ✅ | `session_meter.rs`, ledger reconciliation tests |
| Pricing edits invalidate the ledger | ✅ | `CostDashboard.test.tsx`, `commands.rs` |
| Explicit restore path with rejection handling | ✅ | `store.restore.test.ts`, `Settings.restore.test.tsx` |
| Single `main` branch, version gate in CI | ✅ | `scripts/check-version.mjs`, `.github/workflows/ci.yml` |

## 0.5.0 — Depth on the cost side

| Item | Status | Notes |
|------|--------|-------|
| Per-project cost attribution | ⬜ | Group the ledger by project directory instead of by session file, so "which repo costs the most" is one query |
| Budget alerts that actually fire | ⬜ | Today the budget is a display-only progress bar; it needs an OS notification at threshold |
| Export the ledger | ⬜ | CSV and JSON export of cost records, with the same RFC 4180 escaping the process table uses |
| Historical trend beyond 30 days | ⬜ | The trend query is bounded; older data is aggregated into monthly buckets |

## 0.6.0 — Reach

| Item | Status | Notes |
|------|--------|-------|
| Signed Windows installer | ⬜ | Blocked on a code-signing certificate; until then SmartScreen will warn and the release notes say so |
| Auto-update | ⬜ | Only meaningful after signing |
| Linux AppImage | ⬜ | `.deb` ships today; AppImage needs a bundled WebKitGTK or a documented runtime requirement |
| Homebrew tap | ⬜ | Needs a notarised macOS build first |

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
