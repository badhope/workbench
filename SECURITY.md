# Security Policy

## Supported versions

The current project version is `0.4.0`. A security-fix support policy for
specific versions has not been confirmed.

## Reporting a vulnerability

**Please do not disclose security issues in public issues.**

If private vulnerability reporting is enabled, use the repository's private
security advisory channel. Availability on GitHub or GitCode has not been
confirmed. Otherwise, use a maintainer's private contact method if one is
published; a private contact method has not been confirmed.

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
| Dependencies | CI runs `npm ci`, then `npm audit --omit=dev --audit-level=high` against the public registry (mirrors do not implement the audit API); Dependabot is configured for npm, Cargo, and GitHub Actions updates |

## After disclosure

Once a fix ships, we will credit you in the release notes if you agree.
