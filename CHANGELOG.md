## v0.1.0 — Initial release

- packages/core: Postgres client, pgmq helpers, LISTEN/NOTIFY, advisory locks
- packages/mcp-factory: Dynamic MCP provisioning with Claude-based validation (port 7703)
- packages/worker: Stateless task executor with StorageBackend abstraction
- packages/meta-agent: Always-on coordinator — MCP watch, worker dispatch, self-evolution loop
- packages/gateway: Multi-channel notification bridge — Telegram, Slack, webhook, log
- packages/ui: Vue 3 web dashboard (port 7702) with live WebSocket updates
- Infrastructure: docker-compose, install scripts (macOS/Linux/Windows), .env.example
- Tests: Vitest unit tests across all packages
