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

### Persistent session vs. one-shot ✅ DECIDED
**Decision:** One-shot `spawnSync` in v0.1.0. Persistent `--continue` session in v0.2.

v0.1.0 uses `spawnSync('claude', ['--print', '-p', prompt])` — stateless, one prompt in, one response out. This is the bootstrap. The infrastructure is being built to enable v0.2 where the meta-agent itself becomes a persistent Claude session using `--continue`.

`--continue` is already used in v0.1.0 for worker session resumption: when the watchdog requeues a job, the resumed worker calls `claude --continue` from the same working directory to resume the interrupted Claude session. The `session_id` is stored on `ouro_jobs` and threaded through the requeue message.

v0.2 elevates `--continue` to a first-class pattern for the coordinator itself: instead of a Node.js polling loop, the meta-agent becomes a long-running Claude session with access to `@ouroboros/mcp-server` tools. See `spec/09-mcp-server.md`.

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
Postgres, filesystem, GitHub, SQLite, HTTP/HTTPS, Google Drive, S3 — fully implemented.
OneDrive — stubbed (implement via Ouroboros feedback loop).

---

## Meta-Agent

### Self-evolution safety ✅ DECIDED
**Decision:** PR opens → user notified with diff → `/approve` gate → merge. User is QA. No auto-merge without human approval.

### Evolution rate limiting ✅ DECIDED
**Decision:** Approval-based implicit rate limit. One pending evolution at a time per feedback item. Dead-letter: auto-close PR after 7 days if unapproved.

### Worker isolation ✅ DECIDED
**Decision:** Subprocess (not cc-agent). Simpler, sufficient. StorageBackend interface handles backend differences.

### Worker timeout ✅ DECIDED
**Decision:** No hard timeout. Heartbeat goes stale after 10 minutes idle. Watchdog detects dead/stale workers, resets job to pending, requeues with `session_id`. Resumed worker uses `--continue`. User sees live output.

### Self-healing / watchdog ✅ DECIDED
**Decision:** Loop 4 runs inside meta-agent, polls every 60s. Detects stale jobs (heartbeat > 10min old) and dead service PIDs (gateway, ui). Stale jobs are requeued with session_id for --continue resumption.

---

## Gateway

### Channel abstraction ✅ DECIDED
**Decision:** `ChannelAdapter` interface. Telegram, Slack, generic webhook in v1. Not Telegram-only.

---

## Auth

### Authentication ✅ DECIDED
**Decision:** None for v1. Future: OIDC SSO via `OURO_OIDC_ISSUER` env var for enterprise/corporate deployment.

---

## The Cycling Loop

### @ouroboros/mcp-server ✅ DECIDED (roadmap item)
**Decision:** Build `@ouroboros/mcp-server` in v0.2 to close the Ouroboros loop. See `spec/09-mcp-server.md`.

The v0.1.0 meta-agent (Node.js polling loops + one-shot claude subprocesses) is deliberately a bootstrap: simple enough to implement and reason about, but designed so the v0.2 upgrade replaces the Node.js coordinator with a persistent Claude session. The Control MCP tools (`list_jobs`, `spawn_worker`, `register_mcp`, etc.) mirror exactly what the polling loops do today.

---

## Publishing

### npm publishing ✅ DECIDED
**Decision:** `@ouroboros/*` namespace, public npm. Publish after v1 stable. Goal: make self-hosted AI data infrastructure a one-command install for any enterprise with an Anthropic account.
