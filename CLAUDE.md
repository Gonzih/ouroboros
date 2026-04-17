# Ouroboros — Project Instructions

## What This Actually Is

Ouroboros is a **self-hosted AI data infrastructure** that runs on customer hardware. Its primary job is to connect proprietary data sources to Claude Code via dynamically provisioned MCP servers — so Claude can reason over private data without that data ever leaving the customer's machine or going through a third-party API.

Secondary job: spawn autonomous agents to act on that data. The agents are ephemeral workers. The data connections are the durable value.

**The core loop:**
```
customer data source (DB, drive, files, APIs)
  → mcp-factory provisions MCP server
  → MCP registered in claude project scope
  → claude code can now read/query/reason over that data
  → meta-agent spawns workers that use those tools
  → all intelligence goes through Claude Code CLI (no direct API calls)
  → data never leaves customer infrastructure
```

---

## Hard Constraints

**No direct LLM calls.** All intelligence goes through `claude` CLI subprocess. This ensures:
- Enterprise Anthropic account controls all model access
- Data never leaks through a rogue API call
- Audit trail lives in Claude's session logs
- Customer IT can inspect exactly what model receives

**Postgres only.** No Redis, no Supabase wrapper, no other storage dependencies. One connection string, one Docker container (or system Postgres). pgmq for queues, LISTEN/NOTIFY for pub/sub, advisory locks for process coordination.

**Cross-platform.** Runs on macOS, Linux, and Windows. No launchd-specific code in core packages. Process management is handled by a cross-platform supervisor (see spec/02).

**No hardcoded paths.** Never assume `/Users/feral/` or `/home/user/`. Always resolve from env vars or config.

---

## Architecture in One Sentence

MCP factory at the center, meta-agent as the coordinator, Postgres as the backbone, Claude Code as the only intelligence layer.

---

## Package Map

```
packages/
  core/          — shared types, Postgres client, logger, event bus (LISTEN/NOTIFY)
  meta-agent/    — coordinator: MCP watch, worker dispatch, self-evolution
  worker/        — executes tasks using available MCP tools, reports to Postgres
  ui/            — Vue 3 + TypeScript + Vite. Serves on port 7702.
  gateway/       — ChannelAdapter: Telegram, Slack, webhook. Notification dispatch.
  mcp-factory/   — dynamic MCP provisioning + validation. Serves on port 7703.
  mcp-server/    — Control MCP (20 tools): jobs, mcp registry, feedback/evolution, logs, schedules.
                   Mounted via claude-control.json so Claude can control the system directly.
```

---

## Postgres Schema (all state lives here)

```sql
-- Queues (pgmq extension)
pgmq.create('ouro_tasks');      -- worker task queue
pgmq.create('ouro_feedback');   -- evolution feedback queue

-- Tables
CREATE TABLE ouro_jobs (...)           -- job state + output
CREATE TABLE ouro_mcp_registry (...)   -- registered MCP configs + validation status
CREATE TABLE ouro_feedback (...)       -- evolution history + approval state
CREATE TABLE ouro_logs (...)           -- system logs (partitioned by day)

-- Advisory locks (no table needed)
pg_try_advisory_lock(hashtext('ouro:meta-agent'))   -- singleton coordinator lock

-- Pub/sub (no table needed)
LISTEN/NOTIFY on channel 'ouro_notify'
```

---

## Key Decisions

- **Intelligence**: Claude Code CLI only. `spawnSync('claude', ['--print', '--dangerously-skip-permissions', '-p', prompt])`. No Anthropic SDK, no direct API.
- **Storage**: Postgres only. pgmq for queues, LISTEN/NOTIFY for events, advisory locks for singletons.
- **UI**: Vue 3 + TypeScript + Vite + Pinia. No component library. Custom CSS, dark terminal palette.
- **Gateway**: ChannelAdapter interface — Telegram, Slack, webhook. Not Telegram-only.
- **Evolution**: PR opens → diff sent to user → `/approve` to merge. User is QA.
- **Worker**: StorageBackend interface. git + local in v1. S3/GDrive/OneDrive stubbed.
- **MCP validation**: Spawn claude with temp config, test all endpoints, OPERATIONAL/PARTIAL/FAILED.
- **Auth**: None v1. Future: OIDC SSO via `OURO_OIDC_ISSUER` (enterprise SSO).
- **Platform**: Cross-platform. No launchd, no platform-specific process management in core.

---

## Environment Variables

```
DATABASE_URL                     required  postgres://user:pass@host:5432/ouroboros
CLAUDE_CODE_OAUTH_TOKEN          required  for meta-agent claude subprocesses
OURO_REPO_ROOT                   required  absolute path to ouroboros checkout (for self-evolution)
GITHUB_TOKEN                     optional  git backend worker
GOOGLE_APPLICATION_CREDENTIALS   optional  gdrive:// MCP backend — path to GCP service account JSON
AWS_ACCESS_KEY_ID                optional  s3 worker backend (or use AWS_PROFILE)
AWS_SECRET_ACCESS_KEY            optional  s3 worker backend
AWS_PROFILE                      optional  s3 worker backend (alternative to key/secret)
TELEGRAM_BOT_TOKEN               optional  gateway Telegram adapter
TELEGRAM_CHAT_ID                 optional
SLACK_BOT_TOKEN                  optional  gateway Slack adapter
SLACK_CHANNEL_ID                 optional
SLACK_SIGNING_SECRET             optional  enables Slack inbound (/approve, /reject via Events API)
DISCORD_BOT_TOKEN                optional  gateway Discord adapter
DISCORD_CHANNEL_ID               optional
DISCORD_PUBLIC_KEY               optional  enables Discord inbound (/approve, /reject via Interactions API)
OURO_WEBHOOK_URL                 optional  generic outbound webhook
PORT_GATEWAY                     optional  default 7701
PORT_UI                          optional  default 7702
PORT_MCP_FACTORY                 optional  default 7703
OURO_MAX_WORKERS                 optional  max concurrent worker processes, default 3
OURO_LEGACY_LOOPS                optional  true = use v0.1 Node.js polling loops, default false
OURO_WATCHDOG_INTERVAL_MS        optional  watchdog tick interval, default 60000
OURO_SCHEDULER_INTERVAL_MS       optional  scheduler tick interval, default 30000
OURO_OIDC_ISSUER                 optional  OIDC issuer URL — enables JWT auth on gateway + UI routes
```

---

## Coding Style

- No classes — plain functions and interfaces
- No ORM — raw `pg` or `postgres` library queries
- Error handling: log and continue in loops, never crash meta-agent
- Every package exports a `start()` function as entry point
- All claude subprocess calls check for a completion marker in stdout
- Comments only where logic isn't obvious
- Cross-platform path handling: always `path.join()`, never string concat
