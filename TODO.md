# TODO

## v0.2.0 — meta-agent v2 ✅ complete

- [x] Write PLAN.md and TODO.md
- [x] Create packages/meta-agent/src/coordinator.ts
- [x] Update packages/meta-agent/src/index.ts (coordinator loop + legacy fallback)
- [x] Write packages/meta-agent/src/__tests__/coordinator.test.ts
- [x] Update .gitignore (add .ouro-session, logs/, *.err)
- [x] Update .env.example (add OURO_LEGACY_LOOPS)
- [x] Build and test clean
- [x] Dockerfile.postgres — custom image with pgmq built from source
- [x] docker-compose.yml — build from Dockerfile.postgres
- [x] meta-agent self-invocation (void start() in dist/index.js)

## v0.3.0 — publish prep ✅ complete

- [x] npm publish prep: publishConfig + files field on all 5 publishable packages
- [x] Bump all package versions to 0.2.0
- [x] OIDC auth stub: OURO_OIDC_ISSUER wired in gateway (stub, logs issuer, placeholder for real middleware)
- [x] Installer scripts: scripts/install.sh (macOS launchd + Linux systemd) + scripts/install.ps1 (Windows Task Scheduler) — already complete from v0.2

## v0.4.0 — Approval HTTP API + Worker Heartbeat Dashboard ✅ complete

- [x] gateway: Express HTTP server on PORT_GATEWAY (default 7701)
- [x] gateway: POST /approve/:id and POST /reject/:id — update DB + publish ouro_notify events
- [x] ui: GET /api/processes — list ouro_processes table
- [x] ui: GET /api/workers — join ouro_processes with ouro_jobs
- [x] ui: Workers.vue — process table with heartbeat health badges (green/yellow/red)
- [x] ui: /workers route + nav link

## v0.5.0 — OIDC Middleware (real JWT validation) ✅ complete

- [x] Add `jose` to gateway + UI package dependencies (zero-dep JWKS + JWT validation)
- [x] `packages/gateway/src/oidc.ts` — `createOidcMiddleware(issuer)`: fetch discovery doc, cache JWKS, validate Bearer tokens
- [x] Apply middleware to gateway HTTP routes (`/approve/:id`, `/reject/:id`) when `OURO_OIDC_ISSUER` is set
- [x] Apply same middleware to UI server `/api/*` routes when `OURO_OIDC_ISSUER` is set
- [x] `packages/gateway/src/__tests__/oidc.test.ts` — unit tests with mock JWKS + valid/expired/tampered tokens
- [x] Update `.env.example` with `OURO_OIDC_ISSUER` example value and doc comment
- [x] Remove stub OIDC log from gateway index; real activation log in startHttpServer

## v0.5.1 — housekeeping ✅ complete

- [x] CHANGELOG.md: add missing v0.5.0 entry
- [x] Bump all package.json versions to 0.5.0 (were stuck at 0.2.0 since v0.3.0)

## v0.6.0 — Integration test suite + Gateway rate limiting ✅ complete

- [x] gateway: request rate limiting on `/approve/:id` and `/reject/:id` (prevent duplicate approval spam)
- [x] gateway: idempotency key check — reject double-approval of same feedback id with 409
- [x] Test: end-to-end approval flow — POST /approve/:id → DB state change → ouro_notify event published
- [x] Test: OIDC middleware integration test — verifies discovery-doc fetch path via mocked fetch
- [x] meta-agent: configurable watchdog interval via `OURO_WATCHDOG_INTERVAL_MS` env var (was hardcoded 60s)

## v0.7.0 — Job cancellation + MCP revalidation + smart WebSocket dispatch ✅ complete

- [x] ui: `POST /api/jobs/:id/cancel` — set status to `cancellation_requested`, publish event; returns 404/409 for unknown/terminal jobs
- [x] meta-agent worker-dispatch: `checkCancellations()` runs every 3s — SIGTERMs active workers whose job has `cancellation_requested` status, updates DB to `cancelled`
- [x] ui: Jobs.vue — cancel button shown for `running`/`pending` jobs; optimistic status update on click
- [x] ui: `POST /api/mcp/:name/revalidate` — proxies to mcp-factory `POST /mcp/test/:name`
- [x] mcp-factory: `POST /mcp/test/:name` now publishes `ouro_notify { type: 'mcp_revalidated' }` after DB update
- [x] ui: McpRegistry.vue — revalidate button per row, disables while in-flight
- [x] useWebSocket: smart event dispatch — mcp events refresh mcpStore, evolution events refresh feedbackStore, job events refresh jobsStore (was always refreshing jobs regardless of event type)
- [x] Tests: 3 new tests for `POST /api/jobs/:id/cancel` (200, 409, 404); total 157 tests

## v0.8.0 — Live output push + job retry + job status filter ✅ complete

- [x] worker: `insertOutputLine` publishes `ouro_notify { type: 'job_output_appended', jobId, line }` after each DB write
- [x] useWebSocket: handle `job_output_appended` — route to `jobsStore.appendOutput()` for real-time output display
- [x] ui: `POST /api/jobs/:id/retry` — clone failed/cancelled job as new pending entry, re-enqueue; 409 for non-retryable, 404 for unknown
- [x] ui: jobs store `retryJob(id)` action
- [x] ui: Jobs.vue — retry button for failed/cancelled rows; status filter tabs (all/pending/running/completed/failed/cancelled)
- [x] Tests: 3 retry-endpoint tests + 1 worker output-publish test; total 186 tests

## v0.9.0 — Scheduled jobs + HTTP/HTTPS MCP connector ✅ complete

- [x] mcp-factory: `http`/`https` scheme support via `@modelcontextprotocol/server-fetch` — registers REST API sources as MCP data connections
- [x] core: migration `003_schedules.sql` — `ouro_schedules` table (id, name, cron_expr, backend, target, instructions, enabled, last_run_at, next_run_at)
- [x] meta-agent: `packages/meta-agent/src/loops/scheduler.ts` — `tickScheduler()` checks for due schedules (next_run_at ≤ NOW), creates jobs, enqueues to ouro_tasks, updates next_run_at via `croner`. Runs every 30 s (configurable via `OURO_SCHEDULER_INTERVAL_MS`).
- [x] meta-agent: `startScheduler()` wired into legacy loop mode alongside worker-dispatch, evolution, mcp-watch
- [x] ui: `GET /api/schedules`, `POST /api/schedules`, `PATCH /api/schedules/:id/toggle`, `DELETE /api/schedules/:id`
- [x] ui: `POST /api/schedules` validates cron expression via croner, returns 400 for invalid expr
- [x] ui: `Schedules.vue` — table with cron, backend, last/next run, enable toggle, delete; create modal with cron hint
- [x] ui: `/schedules` route + nav link
- [x] Tests: 3 scheduler loop tests + 8 schedule API tests (create, list, toggle×2, delete×2, bad cron, missing fields). Total: 197 tests

## v1.0.0 — Schedule management in Control MCP ✅ complete

- [x] mcp-server: `packages/mcp-server/src/tools/schedules.ts` — `list_schedules`, `create_schedule`, `toggle_schedule`, `delete_schedule` tools
- [x] mcp-server: `croner` added as runtime dependency for cron validation and `next_run_at` computation
- [x] mcp-server: schedule tools registered in `allTools` and server version bumped to `1.0.0`
- [x] Tests: 8 schedule tool tests. Total: 205 tests

## v1.0.1 — Version bump housekeeping ✅ complete

- [x] Bump all package versions (core, gateway, mcp-factory, worker, meta-agent, ui) from 0.8.0 to 1.0.0 — were missed during v0.9.0 and v1.0.0 releases

## v1.2.1 — persist instructions on job row ✅ complete

- [x] core: migration `004_job_instructions.sql` — `instructions TEXT` column on `ouro_jobs`
- [x] mcp-server/jobs: `spawn_worker` writes instructions to DB row; `get_job_status` returns them
- [x] ui: `/task` POST stores instructions; retry uses stored instructions (fallback to description)
- [x] Tests: +1 retry test (instructions preferred over description). Total: 234 tests

## v1.3.0 — service self-registration + watchdog activation ✅ complete

- [x] gateway: `registerProcess('gateway', pid, ...)` on startup + 30 s heartbeat + `unregisterProcess` on shutdown
- [x] ui: same pattern — `registerProcess('ui', ...)` + heartbeat + unregister on shutdown
- [x] meta-agent/coordinator: version string updated to v1.3.0
- [x] Tests: 4 new startup tests (gateway + UI register/unregister). Total: 241 tests

## v1.4.0 — schedule edit UI ✅ complete

- [x] ui: `updateSchedule(id, payload)` store action — PATCH `/api/schedules/:id` (partial update)
- [x] ui: `Schedules.vue` — edit button per row opens pre-populated modal; save calls `updateSchedule`

## v1.6.0 — retry_job in Control MCP ✅ complete

- [x] mcp-server/jobs: `retry_job` tool — clone failed/cancelled job as new pending entry, re-enqueue
- [x] Tests: 4 new tests (success, instructions fallback, not-found, non-retryable). mcp-server: 54 tests

## Pending

- [ ] Push main branch to origin — requires human action
- [ ] npm publish: run `pnpm -r publish --access public` once org namespace `@ouroboros` is claimed
