# Contributing

Thanks for your interest in contributing to Workbench. This document covers
local development, commit conventions, and the acceptance gates.

## Development environment

| Dependency | Version | Notes |
|------------|---------|-------|
| Node.js | `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0` | locked frontend dependencies; CI uses Node 22 |
| Rust | ≥ 1.90 (`rust-version` in `src-tauri/Cargo.toml`) | backend & desktop shell |
| Windows | 10 / 11 | Windows development; see "Platform scope" |
| WebView2 Runtime | preinstalled on Windows 11 | Windows 10 needs a manual install |

```bash
npm install            # install frontend dependencies
npm run tauri dev      # desktop dev mode (hot reload)
```

Frontend-only work can use the browser demo mode — no Rust toolchain needed:

```bash
npm run dev            # http://localhost:5173, demo data injected automatically
```

## Run before committing

CI runs all of these gates; passing them locally first saves a round trip:

```bash
npm run format:check   # Prettier
npm run lint           # ESLint (zero warnings)
npm test               # frontend unit tests (vitest)
npm run build          # tsc + vite build

cd src-tauri
cargo test             # backend tests + IPC contract export
cargo clippy --all-targets -- -D warnings   # zero warnings
```

### After changing a Rust struct

Frontend IPC types are generated from Rust structs — **do not hand-write them**:

```bash
cd src-tauri
cargo test --test export_bindings   # regenerates src/generated/*.ts
```

`src/generated/` is committed as the contract snapshot; CI compares it and
fails if the Rust side changed without regenerating.

## Branches & commits

`main` is the single long-lived branch and the default branch on every mirror.
Work happens on short-lived branches that are merged back and deleted:

| Prefix | Use |
|--------|-----|
| `feat/` | new capability |
| `fix/` | defect repair |
| `docs/` | documentation only |
| `refactor/` | behaviour-preserving restructure |
| `chore/` | tooling, dependencies, housekeeping |

Rules:

- Branch off `main`, open a PR back into `main`, delete the branch after merge
- No long-lived release branch: a release is a tag on `main` (`v0.4.0`), and
  the tag must match `package.json`, `tauri.conf.json` and `Cargo.toml`
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
  `feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:` / `ci:`
- One commit does one thing — easier to review and to revert

### Versioning

[Semantic Versioning](https://semver.org/) with a three-part `MAJOR.MINOR.PATCH`:

| Change | Bump |
|--------|------|
| Breaking change to stored data, IPC contract or CLI output | MAJOR |
| New feature, new command, new page | MINOR |
| Bug fix, docs, internal refactor | PATCH |

The version is written in four places that must stay in sync — `package.json`,
`package-lock.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
`npm run version:check` verifies them; the release workflow refuses to build a
tag that disagrees.

Every user-visible change gets an entry in [CHANGELOG.md](CHANGELOG.md) under
`Unreleased`, moved into a dated section when the tag is cut.

## Code conventions

- **TypeScript**: strict everywhere, `noUnusedLocals` / `noUnusedParameters`
  on; `any` is not allowed
- **Rust**: `cargo fmt` + `cargo clippy -- -D warnings` with zero warnings
- **Styling**: Tailwind CSS 4 + CSS variables for the dual theme; never
  hardcode colors, go through `@theme` in `global.css`
- **Charts**: ECharts options need **real color values** (ECharts cannot parse
  CSS variables); theme-dependent values come from `src/lib/chartTheme.ts`,
  and `theme` must be listed in `useMemo` dependencies
- **Comments**: explain "why", not "what". When deleting code, delete its
  history comments too

## Platform scope

CI defines Windows, Linux and macOS jobs. The Linux and macOS jobs run backend
checks and build `.deb` and `.app` bundles respectively; the release workflow
also defines builds for all three platforms. Platform-specific changes should
include verification notes for the platforms tested.

## Opening a PR

1. Make sure all gates above pass locally
2. Describe in the PR: what changed, why, and how you verified it
3. UI changes: attach screenshots (use browser demo mode so no real data leaks)

## Reporting issues

- Bugs and feature requests go to
  [Issues](https://github.com/X33834/workbench/issues) (templates provided)
- Security issues must **not** be filed publicly — see [SECURITY.md](SECURITY.md)
