## v0.8.0 — Live output push + job retry + job status filter

- worker: `insertOutputLine` now publishes `ouro_notify { type: 'job_output_appended', jobId, line }` after each DB insert. Output lines are pushed to all connected UI clients in real time via the existing LISTEN/NOTIFY → WebSocket pipeline.
- useWebSocket: `job_output_appended` events are routed to `jobsStore.appendOutput()` — live output appears in the expanded job row without waiting for the 2 s poll cycle.
- ui: `POST /api/jobs/:id/retry` — clones a `failed` or `cancelled` job as a new `pending` entry and re-enqueues it to `ouro_tasks`. Returns 409 for non-retryable states, 404 for unknown IDs.
- ui: Jobs store — `retryJob(id)` action; fetches updated job list on success.
- ui: Jobs.vue — retry button appears for `failed` and `cancelled` rows (accent colour, disables while in-flight). Status filter tabs (all / pending / running / completed / failed / cancelled) added to toolbar; client-side filter via computed property.
- Tests: 3 new retry-endpoint tests (200 retry, 409 non-retryable, 404 not-found). 1 new worker test verifying `publish` is called with `job_output_appended` on each output line. Total: 186 tests across all packages.

## v0.7.0 — Job cancellation + MCP revalidation + smart WebSocket dispatch

- ui: `POST /api/jobs/:id/cancel` — sets job status to `cancellation_requested` and publishes `job_cancel_requested` event. Returns 409 if job is already in a terminal state, 404 if not found.
- meta-agent worker-dispatch: `checkCancellations()` loop runs every 3 s alongside the task-poll loop. Reads DB for active workers with `cancellation_requested` status, sends SIGTERM, updates status to `cancelled`, and publishes `job_complete` event.
- ui: Jobs.vue — cancel button appears for `running` and `pending` jobs. Click stops propagation (doesn't expand the row), disables during in-flight request, optimistically updates job status in the store.
- ui: `POST /api/mcp/:name/revalidate` — proxies to mcp-factory `POST /mcp/test/:name`. Returns mcp-factory's validation result directly.
- mcp-factory: `POST /mcp/test/:name` now publishes `ouro_notify { type: 'mcp_revalidated', name, status }` after updating the DB. Previously only logged.
- ui: McpRegistry.vue — revalidate button per row, alongside the existing delete button. Disables while request is in-flight, re-fetches MCP list on success.
- useWebSocket: smart event routing — `mcp_registered`/`mcp_removed`/`mcp_revalidated` events refresh `mcpStore`; `evolution_approved`/`evolution_rejected`/`evolution_applied` refresh `feedbackStore`; all job/system events refresh `jobsStore`. Previously every Postgres NOTIFY would call `fetchJobs()` unconditionally.
- Tests: 3 new cancel-endpoint tests (200 cancel, 409 terminal-state guard, 404 not-found). Total: 157 tests across all packages.

## v0.6.0 — Gateway rate limiting + idempotency + configurable watchdog

- gateway: `POST /approve/:id` and `POST /reject/:id` now enforce a 10-second per-ID rate limit — returns 429 on duplicate submission within the window.
- gateway: Idempotency guard added — if feedback is already `approved` or `rejected`, returns 409 with current status; only rows in a non-terminal state are updated. Uses `AND status NOT IN ('approved','rejected')` in the `UPDATE` with a follow-up `SELECT` to distinguish 409 from 404.
- gateway: `createRouter()` factory exported so tests can mount a fresh router (with clean rate-limiter state) without starting a real HTTP server.
- Tests: 7 tests for HTTP approval routes (`http.test.ts`) — 200 approve/reject, 404 unknown, 409 double-approve, 429 rate limit for both approve and reject.
- Tests: OIDC discovery-doc path test added — verifies `createOidcMiddleware` calls `fetch` for `/.well-known/openid-configuration` when no `jwksUri` override is provided.
- meta-agent: watchdog loop interval now configurable via `OURO_WATCHDOG_INTERVAL_MS` env var (default 60 000 ms). Documented in `.env.example`.

## v0.5.0 — OIDC Middleware (real JWT validation via JWKS)

- gateway: `packages/gateway/src/oidc.ts` — `createOidcMiddleware(issuer)`: fetches OIDC discovery doc at startup, caches JWKS via `jose`, validates Bearer JWTs (issuer, expiry, signature). Returns 401 for missing/expired/tampered tokens.
- gateway: HTTP routes moved to sub-router; OIDC middleware mounted before router when `OURO_OIDC_ISSUER` is set; `startHttpServer()` is now async.
- ui: API routes on Express Router via `mountRoutes()`; OIDC middleware applied to `/api/*` when `OURO_OIDC_ISSUER` is set. `@ouroboros/gateway` added as workspace dep.
- gateway: exports `./oidc` sub-path so UI can import OIDC middleware without pulling in channel adapters.
- Tests: 6 unit tests covering valid token, wrong issuer, expired token, tampered signature, missing Authorization header, and `res.locals` population.
- `.env.example`: `OURO_OIDC_ISSUER` documented as active (not a future stub).

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
