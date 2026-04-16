## v0.4.0 — Approval HTTP API + Worker Heartbeat Dashboard

- gateway: HTTP server on PORT_GATEWAY (default 7701) with `POST /approve/:id` and `POST /reject/:id`
  — REST-based evolution approval alongside existing Telegram commands
  — Publishes `evolution_approved` / `evolution_rejected` events to ouro_notify on status change
- ui: `GET /api/processes` and `GET /api/workers` endpoints — expose ouro_processes + job join
- ui: Workers view (`/#/workers`) — active process table with live heartbeat health badges
  — Green/yellow/red indicators based on last heartbeat age (<1m / 1-5m / >5m)
  — Auto-refreshes every 30s; shows PID, uptime, job description, job status

## v0.3.0 — Publish prep

- All publishable packages (core, gateway, mcp-factory, meta-agent, worker) bumped to 0.2.0
- Added `publishConfig`, `files`, and `repository` fields to all package manifests
- OIDC auth stub: OURO_OIDC_ISSUER env var wired in gateway — logs issuer, placeholder for real middleware
- Installer scripts already complete (macOS launchd + Linux systemd + Windows Task Scheduler)

Ready to `pnpm -r publish --access public` once `@ouroboros` npm org namespace is claimed.

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
