# Ouroboros

Self-evolving autonomous agent infrastructure.

The meta-agent improves its own codebase from user feedback. Worker agents execute tasks across any storage backend. MCP factory connects private data sources as tools at runtime. The user is QA.

**Status: Specced, ready to implement.**

## Core Design Decisions

| Concern | Decision |
|---------|----------|
| UI stack | Vue 3 + TypeScript + Vite + Pinia. Node.js Express. WebSocket for live updates. No component library. |
| Gateway | `ChannelAdapter` interface — Telegram, Slack, webhook. Not Telegram-only. |
| Self-evolution | Auto-open PR → notify user with diff → user `/approve` → merge. User = QA. |
| Worker timeout | None. Stream output live. Warn after 10min idle. |
| Worker isolation | Subprocess (not cc-agent). StorageBackend interface: git/local/s3/gdrive/onedrive. |
| MCP validation | Spawn Claude with temp config, test all endpoints → OPERATIONAL/PARTIAL/FAILED. |
| Auth | None v1. Future: OIDC SSO via `OURO_OIDC_ISSUER`. |
| Storage | git + local in v1. S3/GDrive/OneDrive stubbed, implement via Ouroboros loop. |
| Publishing | `@ouroboros/*` on npm, public, after v1 stable. |

## Spec Index

| File | What it covers |
|------|---------------|
| `spec/00-overview.md` | Vision, three loops, comparison to cc-agent |
| `spec/01-core.md` | Shared types, Redis client, logger, event bus |
| `spec/02-meta-agent.md` | Self-evolution loop (approval gate), worker dispatch, MCP watch |
| `spec/03-worker.md` | StorageBackend interface, git/local/s3/gdrive/onedrive impls, live streaming |
| `spec/04-ui.md` | Vanilla JS UI, WebSocket protocol, pages, API routes |
| `spec/05-gateway.md` | ChannelAdapter interface, Telegram/Slack/webhook adapters, approval flow |
| `spec/06-mcp-factory.md` | Dynamic provisioning, heavy validation via Claude, connection string schemes |
| `spec/07-open-questions.md` | All 13 decisions resolved with rationale |

## Monorepo Layout

```
packages/
  core/          shared types, Redis, logger, event bus
  meta-agent/    always-on coordinator
  worker/        stateless task executor (spawned per task)
  ui/            vanilla JS web UI (port 7702)
  gateway/       multi-channel notification bridge
  mcp-factory/   runtime MCP provisioning (port 7703)
```

## The Three Loops

```
1. SELF-EVOLUTION (Ouroboros)
   user feedback → ouro:feedback → meta-agent → claude subprocess
   → PR opened → user notified with diff → user /approve → merge → notify

2. WORKER DISPATCH
   user task → ouro:tasks → meta-agent → worker subprocess
   → storage backend prepare → claude runs → commit/push → notify

3. MCP PROVISIONING
   register data source → mcp-factory validates → ~/.claude.json patched
   → next claude subprocess has the tool available
```

## Environment Variables

```
REDIS_URL                required
CLAUDE_CODE_OAUTH_TOKEN  required (meta-agent self-evolution)
TELEGRAM_BOT_TOKEN       optional (gateway Telegram adapter)
TELEGRAM_CHAT_ID         optional
SLACK_BOT_TOKEN          optional (gateway Slack adapter)
SLACK_CHANNEL_ID         optional
OURO_WEBHOOK_URL         optional (gateway webhook adapter)
GITHUB_TOKEN             optional (git backend worker)
PORT_UI                  optional (default 7702)
PORT_MCP_FACTORY         optional (default 7703)
```
