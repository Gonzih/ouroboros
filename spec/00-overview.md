# Ouroboros — System Overview Spec

## Vision

A self-referential autonomous agent harness. The meta-agent's job is to:
1. Improve its own codebase based on user feedback (the Ouroboros loop)
2. Spawn worker agents to do real work across any storage backend
3. Dynamically provision MCP servers to connect new data sources as tools

Unlike existing systems (cc-agent, cc-tg), Ouroboros is:
- **Storage-agnostic** — git is one backend, but work can happen in local folders, S3, Google Drive, etc.
- **Self-modifying** — user feedback directly triggers code changes to Ouroboros itself
- **MCP-generative** — new data sources can be registered at runtime and become tool-accessible

## The Three Loops

### Loop 1 — Self-Evolution (Ouroboros)
```
user writes feedback
  → gateway (Telegram) OR ui (/feedback page)
  → ouro:feedback queue
  → meta-agent dequeues
  → spawns claude subprocess: "implement this feedback, open PR, merge"
  → PR merged → system deployed with new behavior
  → notify user: "done, here's what changed"
```

### Loop 2 — Worker Dispatch
```
user submits task
  → ui (/task) OR gateway (/task command)
  → ouro:tasks queue
  → meta-agent reads storage backend + target
  → spawns worker subprocess with task context
  → worker operates on backend (git/local/s3/gdrive)
  → reports progress to ouro:jobs:{id}
  → completion published to ouro:notify
```

### Loop 3 — MCP Provisioning
```
user registers data source
  → ui (/mcp) OR mcp-factory POST /mcp/register
  → mcp-factory parses connection string
  → generates claude.json mcpServers entry
  → writes to ouro:mcp:registry
  → meta-agent detects new entry
  → patches ~/.claude.json for project scope
  → new MCP tool available in next claude subprocess
```

## What Makes This Different from cc-agent

| Feature | cc-agent | Ouroboros |
|---------|----------|-----------|
| Storage | git only | git, local, s3, gdrive |
| Self-modification | no | yes (feedback loop) |
| MCP provisioning | static config | dynamic at runtime |
| UI evolution | static | evolves via feedback loop |
| Multi-project | one repo per agent | pluggable backends |

## Non-Goals (v1)

- Not a general IDE or dev environment
- Not a multi-user SaaS (single-user, single-machine to start)
- Not replacing Claude Code — it wraps it
- Not building LLM infrastructure — Claude API handles inference
