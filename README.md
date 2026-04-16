# Ouroboros

Self-evolving autonomous agent infrastructure.

The meta-agent improves its own codebase from user feedback. Worker agents execute tasks across any storage backend. MCP factory connects private data sources as tools at runtime.

**Status: Speccing.** Read `spec/` before writing any code.

## Spec Index

| File | What it covers |
|------|---------------|
| `spec/00-overview.md` | Vision, three loops, comparison to cc-agent |
| `spec/01-core.md` | Shared types, Redis client, logger, event bus |
| `spec/02-meta-agent.md` | Coordinator: self-evolution + worker dispatch + MCP watch |
| `spec/03-worker.md` | Task execution across storage backends |
| `spec/04-ui.md` | Next.js UI pages and API routes |
| `spec/05-gateway.md` | Telegram bridge and notification dispatch |
| `spec/06-mcp-factory.md` | Dynamic MCP provisioning from connection strings |
| `spec/07-open-questions.md` | Unresolved design decisions — answer before implementing |

## Monorepo Layout (planned)

```
packages/
  core/          — shared types, Redis, logging
  meta-agent/    — the always-on coordinator
  worker/        — task executor (stateless, spawned per task)
  ui/            — Next.js web UI (port 7702)
  gateway/       — Telegram bridge
  mcp-factory/   — runtime MCP provisioning (port 7703)
```

## The Ouroboros Loop

```
user feedback → meta-agent → claude subprocess → PR → merged → system updated → notify user
```

The system improves itself. That's the point.
