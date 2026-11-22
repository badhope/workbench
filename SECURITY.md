# Security Policy

## Supported versions

Security fixes land on `main` and in the latest release. Older minor versions
are not maintained separately.

## Reporting a vulnerability

**Please do not disclose security issues in public issues.**

Use GitHub's private security advisory flow on any mirror:

- https://github.com/X33834/workbench/security/advisories/new
- https://github.com/Morningstar202604/workbench/security/advisories/new
- https://github.com/badhope/workbench/security/advisories/new

The report stays private until a fix is ready.

### Please include

- Affected version (release tag or commit)
- Reproduction steps or a minimal PoC
- Impact assessment (remotely triggerable? what preconditions?)
- Known mitigations, if any

### Response expectations

| Stage | Target |
|-------|--------|
| Acknowledgement | within 3 business days |
| Initial assessment | within 7 business days |
| Fix or mitigation | agreed based on severity |

## Security design already in place

Workbench is a **local-first** desktop app; its attack surface differs from
typical web apps. Measures already implemented:

| Surface | Measure |
|---------|---------|
| WebView permissions | `capabilities/default.json` is minimal; `opener:allow-open-path` is **not** granted |
| Opening directories | must pass the backend `open_known_path` whitelist; the frontend cannot open arbitrary paths |
| IPC arguments | `ipc_guard.rs` whitelists directories and ports; ports must reuse a just-probed successful value |
| Session ids | `ai.rs` validates charset and length, preventing path/query rewrites when embedded in URLs |
| External requests | redirects never followed; `percent-encode` as a second layer |
| Content security policy | `tauri.conf.json` sets `self` defaults and scripts; it also permits inline styles, data/blob images, data fonts, IPC connections, and localhost:5173 frame sources |
| Data integrity | JSON writes use atomic replacement; on parse failure the file is preserved as `*.corrupt-<timestamp>` before erroring — data is never silently dropped |
| Dangerous operations | killing PID 0/4 and critical system processes is rejected outright; the frontend asks for confirmation |
| HTTP server | `workbench serve` binds `127.0.0.1` by default and has no user authentication. Binding a non-loopback address with `--host` exposes task/project data and write endpoints to the network; put it behind an authenticated reverse proxy, or keep it on loopback |
| Dependencies | CI runs `npm ci`, then `npm audit --omit=dev --audit-level=high` against the public registry (mirrors do not implement the audit API); Dependabot is configured for npm, Cargo, and GitHub Actions updates |

## After disclosure

Once a fix ships, we will credit you in the release notes if you agree.
