## v0.2.0 — Cycling Loop

- packages/mcp-server: Control plane MCP server — 14 tools exposing full Ouroboros internals
- meta-agent v2: Persistent Claude `--continue` session replaces Node.js polling loops
- claude-control.json: Mount Ouroboros control MCP into any Claude session
- .ouro-session: Session continuity across restarts
- OURO_LEGACY_LOOPS=true: Fallback to v0.1 Node.js polling behavior

The cycling loop: Ouroboros spawns Claude → Claude uses Ouroboros MCP tools to reason and act
→ Ouroboros executes → Claude sees results and continues. One persistent session with full context.
Customer data MCPs (provisioned by mcp-factory) + control MCP both mounted simultaneously.

## v0.1.0 — Initial release

- packages/core: Postgres client, pgmq helpers, LISTEN/NOTIFY, advisory locks
- packages/mcp-factory: Dynamic MCP provisioning with Claude-based validation (port 7703)
- packages/worker: Stateless task executor with StorageBackend abstraction
- packages/meta-agent: Always-on coordinator — MCP watch, worker dispatch, self-evolution loop
- packages/gateway: Multi-channel notification bridge — Telegram, Slack, webhook, log
- packages/ui: Vue 3 web dashboard (port 7702) with live WebSocket updates
- Infrastructure: docker-compose, install scripts (macOS/Linux/Windows), .env.example
- Tests: Vitest unit tests across all packages
