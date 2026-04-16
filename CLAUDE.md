# Ouroboros — Project Instructions

## What This Is

Ouroboros is a self-evolving autonomous agent infrastructure. The system improves its own codebase and UI based on user feedback while simultaneously spawning worker agents to do real work. Named after the snake that eats its own tail.

This is a monorepo. Every package is runnable. Implementation follows spec files in `spec/` — read them before writing any code.

---

## Operating Rules

- Read `spec/` before implementing anything
- Never implement without a spec entry or explicit instruction
- All packages use TypeScript + pnpm workspaces
- Redis is the nervous system — all inter-package communication goes through `ouro:*` keys
- Storage is pluggable — git is one backend, not the only one
- Every agent task ends with: PR opened → merged → deployed
- Never push directly to main

## Package Map

```
packages/
  core/          — shared types, Redis, logging, event bus
  meta-agent/    — coordinator: self-evolution + worker dispatch + MCP registry
  worker/        — executes tasks against storage backends
  ui/            — Next.js web UI (port 7702)
  gateway/       — Telegram bridge + notification dispatch
  mcp-factory/   — dynamic MCP provisioning from connection strings
```

## Redis Key Schema

| Key | Type | Purpose |
|-----|------|---------|
| `ouro:logs` | list (capped 2000) | all system logs |
| `ouro:jobs` | hash | job registry by jobId |
| `ouro:jobs:{id}` | hash | per-job state + output |
| `ouro:feedback` | list | user feedback queue → meta-agent |
| `ouro:tasks` | list | worker task queue → worker |
| `ouro:notify` | pub/sub | completion events → gateway |
| `ouro:mcp:registry` | hash | registered MCP configs by name |
| `ouro:instance:lock` | string | singleton lock (pid, TTL 1800s) |

## Environment Variables

| Var | Required | Purpose |
|-----|----------|---------|
| `REDIS_URL` | yes | Redis connection string |
| `TELEGRAM_BOT_TOKEN` | no | Gateway Telegram bot |
| `TELEGRAM_CHAT_ID` | no | Gateway target chat |
| `CLAUDE_CODE_OAUTH_TOKEN` | yes | For meta-agent self-evolution subprocess |
| `GITHUB_TOKEN` | no | For git backend worker |
| `PORT_UI` | no | UI port (default 7702) |
| `PORT_MCP_FACTORY` | no | MCP factory port (default 7703) |

## Coding Style

- No classes — plain functions and interfaces
- No ORM — raw Redis commands via ioredis
- No heavy frameworks in core — it must be importable with zero side effects
- Error handling: log and continue, never crash the meta-agent loop
- Every package exports a `start()` function as the entry point
- Comments only where logic isn't obvious

## Deployment Model

Each package is an npm package under `@ouroboros/*`. Services run via launchd or Docker. The meta-agent is the only always-on process — everything else is spawned on demand.

## Self-Evolution Loop

```
user feedback → ouro:feedback queue
  → meta-agent dequeues
  → spawns claude subprocess (cwd=repo root)
  → claude implements change, opens PR, merges
  → meta-agent notifies via ouro:notify
  → gateway sends Telegram message
```

The system improves itself. This is the core of Ouroboros.
