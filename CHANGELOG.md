## v1.7.3 — http/https scheme-aware validation + version alignment

- mcp-factory: `http` and `https` scheme validation now passes a fetch-specific prompt to the Claude subprocess — instructs it to use the `fetch` tool and treat any HTTP response (including 4xx) as connectivity success. Previously the generic validation prompt was used, which could cause false FAILED results on endpoints that return 4xx for root paths.
- mcp-factory: `POST /mcp/test/:name` (re-validation endpoint) now parses the stored connection string scheme and passes it through to `validateMcp`, so re-validation uses the correct scheme-aware prompt rather than falling back to the generic path.
- spec/06-mcp-factory.md: updated to reflect `@modelcontextprotocol/server-fetch` as the live implementation for http/https (was listed as stub).
- spec/07-open-questions.md: HTTP/HTTPS moved from stubbed to fully implemented.
- chore: bump core, mcp-factory, mcp-server, worker, ui from 1.6.0 to 1.7.3 — versions drifted during v1.7.0–v1.7.2 releases.
- Tests: mcp-factory 49 tests pass (validate.ts: 3 new http/https tests added in this cycle).

## v1.7.2 — coordinator prompt gap fix

- meta-agent/coordinator: `retry_job` and `submit_feedback` were missing from the coordinator prompt despite being live tools in `@ouroboros/mcp-server`. Coordinator now knows to use `retry_job(jobId)` to requeue failed/cancelled jobs and `submit_feedback(text, source)` to propose its own code improvements.
- Tests: coordinator prompt tests extended to assert presence of both tools. meta-agent: 110 tests (unchanged count, new assertions added).

## v1.7.1 — meta-agent test coverage improvements

- meta-agent/coordinator: tests cover stdout/stderr data event handlers — non-empty line logging, empty-line skip, real stderr logging, and "no stdin data received" filter.
- meta-agent/watchdog: test covers EPERM branch of `isPidAlive` (process exists but permission denied → treated as alive, no requeue).
- meta-agent/worker-dispatch: tests cover stderr readline handler body (stderrLines collection + `[stderr]` prefixed output), ack-failure catch, and nack-failure catch.
- meta-agent/scheduler: test covers `startScheduler` tick-error catch handler (logs `tick error:` on `tickScheduler` throw).
- meta-agent total: 96 → 105 tests. `coordinator.ts` reaches 100% statement coverage.

## v1.7.0 — Discord gateway adapter

- gateway/discord: `DiscordAdapter` added — outbound notifications via Discord channels API (`Bot` token auth); inbound `/approve`, `/reject`, `/status`, `/jobs` slash commands via Discord Interactions API (Ed25519 signature verification using Node.js built-in `crypto`, no external dependencies).
- gateway/http: `POST /discord/interactions` route mounted before `express.json()` so raw body is available for Ed25519 verification. Enabled by setting `DISCORD_PUBLIC_KEY` alongside `DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID`.
- `.env.example`: Discord env vars documented (`DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID`, `DISCORD_PUBLIC_KEY`).
- Tests: 14 new gateway tests (DiscordAdapter name/start/stop, PING response, approve/reject/status/jobs commands, not-found path, unknown interaction type, invalid JSON, invalid signature; startHttpServer Discord route mounting). gateway: 113 tests.

## v1.6.0 — retry_job in Control MCP

- mcp-server/jobs: `retry_job` tool added — creates a new pending job from a failed or cancelled one, preserving backend/target/instructions. Returns `{ job_id }` for the new job, or `{ error }` for not-found/non-retryable states. Closes the gap between UI retry and MCP control plane.
- Tests: 4 new mcp-server tests (retry success, instructions-fallback-to-description, not-found, non-retryable status). mcp-server: 54 tests.

## v1.5.0 — Slack inbound: /approve and /reject via Events API

- gateway/slack: `SlackAdapter.handleEvent()` added — verifies HMAC-SHA256 Slack signatures, guards against replay attacks (5-minute window), handles the URL verification challenge, and routes `/approve <id>` and `/reject <id>` message events to the same DB updates used by Telegram and the HTTP REST endpoints. Slack inbound is now at full parity with Telegram.
- gateway/http: `POST /slack/events` mounted before `express.json()` so the raw body is available for signature verification. Enabled by setting `SLACK_SIGNING_SECRET` alongside existing `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_ID`.
- gateway/slack: bot messages and subtypes are filtered — only direct human message events trigger command handling.
- coordinator: benign "no stdin data received" warning from Claude subprocess filtered from stderr logs to reduce noise.
- Tests: 12 new gateway tests covering HMAC verification, replay rejection, URL challenge, approve/reject DB writes, bot-message filtering, and the HTTP route end-to-end. Total: 48 gateway tests.
- Tests: 18 new meta-agent tests — mcp-watch (10: subscribe setup, event guard, log/publish on valid events, unknown-payload guard) + worker-dispatch (8: queue polling, nack on invalid fields, spawn for valid tasks, OURO_TASK env encoding, OURO_REPO_ROOT resolution). meta-agent: 63 tests.
- Tests: 27 new core/mcp-factory tests — core/events (11: publish/subscribe, callback error swallowing, reconnect watchdog, unsubscribe idempotency), core/log (4: stdout write + DB insert, swallows DB errors), mcp-factory/server (12: all four HTTP endpoints). Total: 298 tests across all packages.

## v1.4.0 — Schedule edit UI

- ui: `updateSchedule(id, payload)` store action added to `schedulesStore` — calls `PATCH /api/schedules/:id` with a partial-update payload (any subset of name, cron_expr, backend, target, instructions).
- ui: `Schedules.vue` — edit button added per row; clicking opens the create modal pre-populated with the row's current values. Saving calls `updateSchedule` rather than `createSchedule`. Modal title and submit label update contextually (Create / Save Changes).

## v1.3.0 — service self-registration + watchdog activation

- gateway: `start()` now calls `registerProcess('gateway', pid, 'node', argv)` after `startHttpServer()` and emits a 30 s heartbeat via `setInterval`. `unregisterProcess('gateway')` is called in the shutdown handler before process exit, so the watchdog's row is removed cleanly.
- ui: `start()` mirrors the same pattern — `registerProcess('ui', ...)` after the HTTP server binds, heartbeat every 30 s, `unregisterProcess('ui')` in the SIGTERM/SIGINT shutdown handler.
- meta-agent/coordinator: version string updated to v1.3.0.
- This activates the watchdog's service restart branch (loop 4 step 2): it now has rows to query, so dead gateway/UI processes will be detected and respawned without manual intervention.
- Tests: 4 new tests (2 gateway startup: registers on start, unregisters on SIGTERM; 2 UI startup: same). Total: 241 tests.

## v1.2.1 — persist instructions on job row

- core: migration `004_job_instructions.sql` — adds `instructions TEXT` column to `ouro_jobs`; existing rows get NULL which the retry path handles gracefully.
- mcp-server/jobs: `spawn_worker` now stores the `instructions` field in the job row (previously only in the pgmq queue message); `get_job_status` returns `instructions` alongside status/timing/error.
- ui: `POST /api/task` stores instructions in the job row; `POST /api/jobs/:id/retry` reads the stored instructions and re-enqueues them (falls back to `description` for rows created before this version).
- Tests: 1 new retry test confirming stored instructions are used in preference to description. Total: 234 tests.

## v1.2.0 — schedule editing + job pagination + extended backend support

- mcp-server/schedules: new `update_schedule` MCP tool — updates any subset of a schedule's fields (name, cron_expr, backend, target, instructions) with partial-update semantics; omitted fields keep their current values. Changing `cron_expr` recomputes `next_run_at` via croner. Returns `{ error }` on invalid cron or unknown ID without throwing.
- mcp-server/schedules: `create_schedule` and `update_schedule` backend enum now includes `s3`, `gdrive`, `onedrive` — schedule workers can now target the storage backends added in v1.1.0.
- mcp-server/jobs: `list_jobs` now accepts an `offset` parameter for cursor-style pagination alongside the existing `limit`.
- ui: `PATCH /api/schedules/:id` REST endpoint mirrors `update_schedule` — partial update with cron validation; returns 400 on invalid cron, 404 on unknown ID, 400 if no fields provided.
- meta-agent/coordinator: coordinator prompt updated to reference `update_schedule` alongside the other schedule tools; version string aligned to v1.2.0.
- Tests: 9 new tests (mcp-server: 4 update_schedule cases + 1 offset pagination; ui: 4 PATCH schedule cases). Total: 233 tests.

## v1.1.2 — coordinator mode now runs all execution loops

- meta-agent: coordinator mode (default, non-legacy) was missing `startWorkerDispatch`, `startEvolution`, and `startScheduler` from its `Promise.all`. Jobs created via `spawn_worker` MCP calls were enqueued to `ouro_tasks` but never dequeued — no workers ever ran. Scheduled jobs never triggered. Feedback never got processed into PRs. All three loops are now included alongside `watchdogLoop` and `runCoordinatorLoop`. Legacy mode is unaffected.

## v1.1.1 — two-phase job cancellation + MCP schema fixes

- mcp-server/jobs: `cancel_job` now differentiates pending vs running jobs — pending jobs are cancelled immediately (`status = 'cancelled'`, `completed_at = NOW()`) without going through the watchdog cycle; running jobs still get `cancellation_requested` so worker-dispatch can send SIGTERM and clean up properly.
- mcp-server/jobs: `list_jobs` status filter enum now includes `'cancellation_requested'` (was missing, causing Claude to receive an error when filtering by that status).
- mcp-server/jobs: `spawn_worker` / `create_job` backend enum now includes `'s3'`, `'gdrive'`, `'onedrive'` — these backends were implemented in v1.1.0 but not added to the MCP tool schema, making them unreachable via Claude.
- ui: `POST /api/jobs/:id/cancel` mirrors the two-phase logic — pending jobs are cancelled immediately with 200; running jobs still get `cancellation_requested`.
- meta-agent/coordinator: test expectation aligned to v1.1.0 version string (housekeeping).
- Tests: 3 net new tests (mcp-server cancel tool: two-phase behaviour; ui cancel endpoint: pending-job path). Total: 224 tests.

## v1.1.0 — real storage backends + worker resume fix + cross-platform cleanup

- worker: `S3Backend`, `GDriveBackend`, and `OneDriveBackend` are now fully implemented (previously stubs). `S3Backend` uses `@aws-sdk/client-s3` with `GetObjectCommand`/`PutObjectCommand`/`DeleteObjectCommand`; requires `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`. `GDriveBackend` uses `googleapis` with service-account credentials (`GDRIVE_CREDENTIALS_JSON`). `OneDriveBackend` uses `@azure/msal-node` + `@microsoft/microsoft-graph-client` with client-credential flow; requires `ONEDRIVE_TENANT_ID`, `ONEDRIVE_CLIENT_ID`, `ONEDRIVE_CLIENT_SECRET`.
- worker: `cleanup()` in all backends now uses `os.tmpdir()` (via `node:os`) and `fs.rmSync({ recursive: true, force: true })` instead of shell `rm -rf` — fully cross-platform (Windows-safe).
- meta-agent: worker resume now passes `--print` and `-p` alongside `--continue` — without them the subprocess hung waiting for stdin. Watchdog tests updated to match new spawn signature.
- meta-agent/coordinator: version string aligned to `1.1.0`; worker-dispatch `TaskInput.sessionId` typed as `string | undefined` (was missing the undefined branch).
- mcp-factory: test suite migrated from legacy `node:test` format to vitest; config consistency pass on snapshot tests.
- worker: dead session-ID extraction regex removed (was never matched against actual output); `vite-env.d.ts` triple-slash reference added to ui package so `import.meta.env` types resolve correctly.
- Tests: 12 new backend tests (S3 upload/download/delete, GDrive upload/download/delete, OneDrive upload/download/delete, cleanup). Total: 221 tests.

## v1.0.1 — merge_failed recovery + version bump housekeeping

- meta-agent/evolution: `runClaude` now throws on non-zero exit code (was silently treating failures as success); `pollForApproval` marks `merge_failed` status and returns early instead of falling through to `applied` state and triggering a rebuild/restart on a failed merge.
- mcp-server/feedback: `approve_evolution` now accepts jobs with `merge_failed` status (in addition to `pr_open`) — coordinator can retry a merge without needing a new PR cycle; `list_feedback` status enum includes `merge_failed`.
- meta-agent/coordinator: coordinator prompt instructs Claude to run `gh pr merge` after approving and to retry on `merge_failed` status.
- ui: `StatusBadge` renders `merge_failed` state in red; `useWebSocket` routes `evolution_proposed` and `evolution_merge_failed` events to `feedbackStore`.
- All six publishable packages (core, gateway, mcp-factory, meta-agent, ui, worker) bumped to `1.0.0` — version fields were missed during the v0.9.0 and v1.0.0 release cycles.
- Tests: 4 new tests (merge_failed retry + list_feedback filter in mcp-server; merge_failed branch in coordinator). Total: 209 tests.

## v1.0.0 — Schedule management in Control MCP

- mcp-server: `packages/mcp-server/src/tools/schedules.ts` — four new MCP tools expose schedule management to Claude: `list_schedules` (list all schedules), `create_schedule` (insert with cron validation via croner, computes `next_run_at`), `toggle_schedule` (flip enabled state), `delete_schedule` (remove by ID). Returns structured JSON; `create_schedule` returns `{ error }` on invalid cron expression without throwing.
- mcp-server: `croner` added as a runtime dependency so `create_schedule` can validate expressions and compute `next_run_at` consistently with the scheduler loop.
- mcp-server: server version string bumped to `1.0.0`; all four schedule tools registered in `allTools` and dispatched in `CallToolRequestSchema` handler.
- Tests: 8 new schedule tool tests (list, create-ok, create-bad-cron, toggle-ok, toggle-404, delete-ok, delete-404, unknown-name). Total: 205 tests across all packages.

## v0.9.0 — Scheduled jobs + HTTP/HTTPS MCP connector

- mcp-factory: `http` and `https` connection string schemes now resolve to `@modelcontextprotocol/server-fetch`, enabling REST API data sources as MCP connections. Claude can use the `fetch` tool to query any HTTP endpoint registered as an MCP.
- core: migration `003_schedules.sql` adds `ouro_schedules` table — stores recurring job templates with a cron expression, backend, target, instructions, enabled flag, and computed last/next run timestamps.
- meta-agent: `packages/meta-agent/src/loops/scheduler.ts` — `tickScheduler()` queries for schedules with `next_run_at ≤ NOW()`, inserts a new `ouro_jobs` row and enqueues to `ouro_tasks` for each due schedule, then updates `last_run_at` and computes the next occurrence via `croner`. Scheduler loop polls every 30 s (configurable via `OURO_SCHEDULER_INTERVAL_MS`). `startScheduler()` runs alongside worker-dispatch, evolution, and mcp-watch in legacy mode.
- ui: `GET /api/schedules` — list all schedules. `POST /api/schedules` — create with name, cron_expr, backend, target, instructions; validates cron expression (returns 400 for invalid expr) and stores computed `next_run_at`. `PATCH /api/schedules/:id/toggle` — flip enabled state. `DELETE /api/schedules/:id` — remove.
- ui: `Schedules.vue` — table showing cron expression, backend, last and next run timestamps, per-row enable/disable toggle and delete button. Create modal with cron syntax hint. Nav link between jobs and workers.
- Tests: 3 scheduler loop unit tests (due dispatch, no-op when none due, multi-schedule batch). 8 schedule API tests (200 create, 400 missing fields, 400 invalid cron, 200 list, 200/404 toggle, 200/404 delete). Total: 197 tests.

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
