# Open Questions — Decision Log

All decisions resolved. Recording final state.

---

## Storage

### Storage backend ✅ DECIDED
**Decision:** Postgres only. No Redis. No Supabase wrapper.

- Queues: `pgmq` extension (ships with Postgres 14+)
- Pub/sub: `LISTEN/NOTIFY` (built into Postgres, no extra setup)
- Singleton lock: `pg_try_advisory_lock` (auto-releases on crash, no TTL needed)
- State: plain tables with indexes
- One dependency: `DATABASE_URL`. One Docker container or system Postgres.

---

## Intelligence Layer

### LLM access ✅ DECIDED
**Decision:** Claude Code CLI only. No direct Anthropic API calls anywhere in the codebase.

All intelligence goes through `spawnSync('claude', ['--print', '--dangerously-skip-permissions', '-p', prompt])`. This ensures:
- Enterprise Anthropic account governs all model access
- Data never leaks through a rogue API call  
- IT can audit what the model sees
- No API key management in the codebase

---

## Platform

### Cross-platform ✅ DECIDED
**Decision:** macOS, Linux, Windows all supported.

- No launchd in core code
- Installer script generates platform-appropriate supervisor config
- All paths via `path.join()` / `os.homedir()` — never hardcoded
- `claude` binary must be in PATH (users install Claude Code themselves)

---

## UI

### Framework ✅ DECIDED
**Decision:** Vue 3 + TypeScript + Vite + Pinia. Node.js Express server. WebSocket for live updates.

No component library. Custom CSS with dark terminal aesthetic. Components are individually modifiable by the meta-agent (self-evolution target).

---

## MCP Factory

### Validation ✅ DECIDED
**Decision:** Spawn Claude with temp MCP config, call every tool, classify OPERATIONAL/PARTIAL/FAILED. Only register if not FAILED.

This is the core differentiator — we prove the data connection works before claiming it does.

### Supported schemes v1 ✅ DECIDED
Postgres, filesystem, GitHub, SQLite — fully implemented.
S3, Google Drive, OneDrive, HTTP API — stubbed (implement via Ouroboros feedback loop).

---

## Meta-Agent

### Self-evolution safety ✅ DECIDED
**Decision:** PR opens → user notified with diff → `/approve` gate → merge. User is QA. No auto-merge without human approval.

### Evolution rate limiting ✅ DECIDED
**Decision:** Approval-based implicit rate limit. One pending evolution at a time per feedback item. Dead-letter: auto-close PR after 7 days if unapproved.

### Worker isolation ✅ DECIDED
**Decision:** Subprocess (not cc-agent). Simpler, sufficient. StorageBackend interface handles backend differences.

### Worker timeout ✅ DECIDED
**Decision:** No hard timeout. Stream output live. Log heartbeat warning after 10min idle. User sees what's happening.

---

## Gateway

### Channel abstraction ✅ DECIDED
**Decision:** `ChannelAdapter` interface. Telegram, Slack, generic webhook in v1. Not Telegram-only.

---

## Auth

### Authentication ✅ DECIDED
**Decision:** None for v1. Future: OIDC SSO via `OURO_OIDC_ISSUER` env var for enterprise/corporate deployment.

---

## Publishing

### npm publishing ✅ DECIDED
**Decision:** `@ouroboros/*` namespace, public npm. Publish after v1 stable. Goal: make self-hosted AI data infrastructure a one-command install for any enterprise with an Anthropic account.
