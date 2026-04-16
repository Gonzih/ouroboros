# Ouroboros

Self-hosted AI data infrastructure. Connects proprietary data to Claude Code via dynamically provisioned MCP servers. Runs on customer hardware. Data never leaves the machine.

**Status: v0.1.0 implemented. Core loops running.**

---

## What It Does

You have a Postgres database, a folder of PDFs, an internal GitHub repo. You want Claude to reason over them. You give Ouroboros a connection string. It provisions an MCP server, proves it works by testing every tool with Claude, patches your `~/.claude.json`, and tells you it's ready. Claude can now query your database, read your files, and browse your code — all locally, all under your enterprise Anthropic account.

## Hard Constraints

| Constraint | Why |
|------------|-----|
| No direct LLM API calls | Enterprise account governs all model access. Data never leaks. |
| Postgres only | One dependency. pgmq for queues, LISTEN/NOTIFY for events, advisory locks. |
| Runs on macOS, Linux, Windows | Customer hardware, not a cloud service. |
| Claude Code CLI only | `claude --print --dangerously-skip-permissions` for all intelligence. |

## Architecture

The name "Ouroboros" refers to the snake eating its own tail — a closed loop. In v0.2, that loop closes completely:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Ouroboros Infrastructure                      │
│   Postgres + pgmq   │   mcp-factory   │   gateway   │   ui      │
└─────────────────────┬───────────────────────────────────────────┘
                      │ spawns + manages
                      ▼
          ┌─────────────────────────┐
          │  Claude Code            │
          │  (--continue session)   │  ← v0.2: persistent coordinator
          └────────┬────────────────┘
                   │ uses two MCP categories
          ┌────────┴────────┐
          │                 │
          ▼                 ▼
  @ouroboros/mcp-server    Customer Data MCPs
  (Control MCP — v0.2)     (provisioned by mcp-factory)
  list_jobs()              postgres://corp-db/warehouse
  spawn_worker()           file:///data/reports
  register_mcp()           github://acme/internal-wiki
  approve_evolution()      sqlite:///app.db
  get_logs()
          │                 │
          └────────┬────────┘
                   │ reasons → acts → sees results → reasons again
                   ▼
          (loop — snake eats its tail)
```

**v0.1.0 (now)**: Ouroboros is a Node.js coordinator that spawns one-shot `claude` subprocesses. Claude is a tool called by the system.

**v0.2 (next)**: `@ouroboros/mcp-server` exposes Ouroboros internals as MCP tools. Claude becomes the coordinator — a persistent `--continue` session with access to both control tools and customer data. The Node.js polling loops become MCP tool calls. Claude reasons continuously instead of being invoked per-prompt.

## The Four Loops (v0.1.0)

```
Loop 1 — MCP Provisioning
  connection string → validate with Claude → patch ~/.claude.json → tools available

Loop 2 — Worker Dispatch
  pgmq task → spawn worker subprocess → claude uses MCP tools → result → notify

Loop 3 — Self-Evolution
  user feedback → claude opens PR → user /approve → merge → rebuild → restart

Loop 4 — Watchdog
  every 60s: dead worker PIDs → reset + requeue with session_id (--continue resume)
             dead services → restart subprocess
```

## Core Design

| Concern | Decision |
|---------|----------|
| Storage | Postgres only (pgmq + LISTEN/NOTIFY + advisory locks) |
| Intelligence | Claude Code CLI subprocess. No Anthropic SDK. |
| UI | Vue 3 + TypeScript + Vite + Pinia. Express + WebSocket. |
| Gateway | `ChannelAdapter` interface — Telegram, Slack, webhook |
| MCP validation | Claude tests every tool endpoint. OPERATIONAL/PARTIAL/FAILED. |
| Self-evolution | PR → user gets diff → `/approve` → merge. User is QA. |
| Platform | Cross-platform. Installer generates platform supervisor config. |
| Auth | None v1. Future: OIDC SSO via `OURO_OIDC_ISSUER`. |
| Self-healing | Watchdog loop: heartbeats, dead PID detection, --continue resume |

## Roadmap

### v0.1.0 — Bootstrap (implemented)
- [x] Four loops: MCP provisioning, worker dispatch, self-evolution, watchdog
- [x] Worker session continuity: 30s heartbeats, --continue on resume
- [x] Multi-channel gateway: Telegram, Slack, webhook, log-only
- [x] Dynamic MCP provisioning: pg, file, github, sqlite
- [x] Cross-platform installer (macOS launchd, Linux systemd, Windows NSSM)
- [x] Vue 3 UI on port 7702, MCP factory HTTP on port 7703

### v0.2 — Cycling Loop (roadmap)
- [ ] `@ouroboros/mcp-server` — Control MCP exposing Ouroboros internals as tools
- [ ] Persistent Claude `--continue` session as meta-agent coordinator
- [ ] Claude self-diagnosis: `get_logs()` → notice → `submit_feedback()` → auto-propose fix
- [ ] Long-horizon reasoning: single session accumulates context across all jobs

### v0.3 — Multi-tenant (future)
- [ ] OIDC SSO via `OURO_OIDC_ISSUER`
- [ ] Per-user job isolation
- [ ] MCP registry scoped per project/user

## Spec Index

| File | What it covers |
|------|---------------|
| `spec/00-overview.md` | Core purpose, four loops, cycling loop, convergence table |
| `spec/01-core.md` | Postgres schema, pgmq helpers, LISTEN/NOTIFY event bus, types |
| `spec/02-meta-agent.md` | Coordinator: four loops, watchdog, --continue, v0.2 vision |
| `spec/03-worker.md` | StorageBackend interface, task execution, heartbeats, session continuity |
| `spec/04-ui.md` | Vue 3 UI, WebSocket protocol, pages, REST API |
| `spec/05-gateway.md` | ChannelAdapter interface, Telegram/Slack/webhook, approval flow |
| `spec/06-mcp-factory.md` | Dynamic MCP provisioning, Claude-based validation, connection schemes |
| `spec/07-open-questions.md` | All decisions resolved with rationale |
| `spec/08-self-healing.md` | Watchdog loop, worker session continuity, post-evolution restart |
| `spec/09-mcp-server.md` | @ouroboros/mcp-server v0.2 roadmap, cycling loop design, tool list |

## Environment Variables

```
DATABASE_URL              required   postgres://user:pass@host:5432/ouroboros
CLAUDE_CODE_OAUTH_TOKEN   required   for meta-agent claude subprocesses
OURO_REPO_ROOT            required   absolute path to this checkout
GITHUB_TOKEN              optional   git backend + GitHub MCP
TELEGRAM_BOT_TOKEN        optional   gateway Telegram adapter
TELEGRAM_CHAT_ID          optional
SLACK_BOT_TOKEN           optional   gateway Slack adapter
SLACK_CHANNEL_ID          optional
OURO_WEBHOOK_URL          optional   generic outbound webhook
PORT_UI                   optional   default 7702
PORT_MCP_FACTORY          optional   default 7703
OURO_MAX_WORKERS          optional   default 3
CLAUDE_BIN                optional   override claude binary path
```

## Quick Start

### Prerequisites
- Node.js 22+
- pnpm (`npm install -g pnpm`)
- Claude Code CLI (install from https://claude.ai/code, authenticate with your enterprise account)
- Postgres 14+ with pgmq extension (or use Docker)

### 1. Start Postgres

```bash
docker-compose up -d
```

### 2. Install

```bash
# macOS / Linux
chmod +x scripts/install.sh && ./scripts/install.sh

# Windows (PowerShell)
.\scripts\install.ps1
```

The installer will:
- Check prerequisites
- Create `.env` from `.env.example` on first run (then re-run after editing)
- Run `pnpm install && pnpm build`
- Register the meta-agent as a background service (launchd / systemd / Task Scheduler)

### 3. Configure

Edit `.env`:
```
DATABASE_URL=postgres://ouroboros:ouroboros@localhost:5432/ouroboros
CLAUDE_CODE_OAUTH_TOKEN=<your token from claude.ai/settings>
OURO_REPO_ROOT=/absolute/path/to/this/checkout
```

Then re-run the install script to register the service with the correct values.

### 4. Start Services

```bash
# macOS (after install.sh)
launchctl load ~/Library/LaunchAgents/com.ouroboros.meta-agent.plist

# Linux (after install.sh)
systemctl --user enable --now ouroboros-meta-agent

# Dev (no supervisor)
pnpm --filter @ouroboros/meta-agent start &
pnpm --filter @ouroboros/gateway start &
pnpm --filter @ouroboros/ui start
```

### 5. Connect Your Data

Open http://localhost:7702 → MCP Registry → Register

```
name: my-database
connection: postgres://user:pass@host/mydb
```

Ouroboros validates the connection with Claude, patches `~/.claude.json`, and Claude can now query your database.

---

## Packages

```
packages/
  core/          Postgres client, pgmq helpers, LISTEN/NOTIFY, types, migrations
  meta-agent/    Always-on coordinator (four loops, advisory lock singleton)
  worker/        Stateless task executor with StorageBackend abstraction
  ui/            Vue 3 web UI (port 7702)
  gateway/       Multi-channel notification bridge
  mcp-factory/   Dynamic MCP provisioning with Claude-based validation (port 7703)
```
