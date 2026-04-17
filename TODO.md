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

## v1.7.0 — Discord gateway adapter ✅ complete

- [x] gateway: `DiscordAdapter` — outbound via channels API; inbound slash commands via Interactions API with Ed25519 sig verification (no external deps)
- [x] gateway/http: `POST /discord/interactions` route; raw body for Ed25519 verification
- [x] gateway/index: wire up from `DISCORD_BOT_TOKEN` / `DISCORD_CHANNEL_ID` / `DISCORD_PUBLIC_KEY`
- [x] `.env.example`: Discord vars documented
- [x] Tests: 14 new tests. gateway: 113 tests total

## v1.7.1 — meta-agent test coverage improvements ✅ complete

- [x] meta-agent/coordinator: 4 tests for stdout/stderr data handlers → coordinator.ts hits 100%
- [x] meta-agent/watchdog: EPERM branch test (process.kill throws EPERM → treated as alive)
- [x] meta-agent/worker-dispatch: stderr readline handler body, ack-failure catch, nack-failure catch
- [x] meta-agent/scheduler: startScheduler tick-error catch handler test
- [x] meta-agent total: 96 → 105 tests

## v1.7.2 — coordinator prompt gap fix ✅ complete

- [x] meta-agent/coordinator: add `retry_job` and `submit_feedback` to coordinator prompt
- [x] Tests: assert both tools appear in prompt (coordinator.test.ts)
- [x] Bump meta-agent version to 1.7.2, update coordinator version string

## v1.7.3 — http/https scheme-aware validation + version alignment ✅ complete

- [x] mcp-factory: fetch-specific validation prompt for http/https schemes (treat any HTTP response as connectivity success)
- [x] mcp-factory: re-validation endpoint passes scheme through to validateMcp
- [x] spec/06-mcp-factory.md: http/https marked as v1 (was stub)
- [x] spec/07-open-questions.md: HTTP/HTTPS moved from stubbed to fully implemented
- [x] chore: bump core, mcp-factory, mcp-server, worker, ui from 1.6.0 → 1.7.3

## v1.8.0 — gateway event alignment ✅ complete

- [x] evolution.ts: all five `publish('ouro_notify', ...)` calls use `id` (not `feedbackId`) — fixes `/approve undefined` shown to users
- [x] gateway.ts: replace dead `evolution_result` handler with `evolution_approved`, `evolution_applied`, `evolution_rejected`, `evolution_merge_failed`
- [x] gateway.ts: `evolution_proposed` message now includes `prUrl`; `formatEvent` default returns `null` to drop unknown types cleanly
- [x] Tests: 4 new gateway event tests + 1 unknown-type drop test; evolution.test.ts assertions updated. gateway: 117 tests. Total: 473
- [x] coordinator.ts: version string bumped to v1.7.3; CLAUDE.md tool count corrected to 20

## v1.9.0 — approve/reject in UI + complete backend list ✅ complete

- [x] ui: `POST /api/feedback/:id/approve` — update status to `approved`, publish `evolution_approved` event
- [x] ui: `POST /api/feedback/:id/reject` — update status to `rejected`, accept optional `reason` body, publish `evolution_rejected` event
- [x] ui: feedback store `approveFeedback(id)` and `rejectFeedback(id, reason?)` actions
- [x] ui: Feedback.vue — approve/reject buttons for `pr_open` and `merge_failed` rows; disabled while in-flight; error display
- [x] ui: Dashboard.vue — gdrive and onedrive added to backend dropdown (were missing; worker already supported them)
- [x] Tests: 7 new tests (approve: success, 409, 404; reject: success, no-reason, 409, 404). ui: 58 tests. Total: 480

## v2.0.0 — live log push via WebSocket ✅ complete

- [x] core: `log()` uses `INSERT RETURNING id, ts` and publishes `ouro_notify { type: 'log_entry', ... }`
- [x] ui: `useWebSocket` handles `log_entry` in notify dispatch — calls `logsStore.prependLog()` for real-time Logs page updates
- [x] chore: bump all package versions to 2.0.0 (core, gateway, mcp-factory, mcp-server, meta-agent, worker, ui)
- [x] Tests: 3 new core/log tests. core: 54 tests. Total: 483

## v2.1.0 — Google Drive MCP backend ✅ complete

- [x] mcp-factory: implement `gdrive` scheme in `generateConfig` — uses `@modelcontextprotocol/server-gdrive` with `GOOGLE_APPLICATION_CREDENTIALS` env var
- [x] mcp-factory: add `gdrive` validation prompt to `VALIDATION_PROMPTS` in `validate.ts`
- [x] mcp-factory: 2 new `generateConfig` tests for gdrive; remove gdrive from stub scheme list
- [x] `.env.example`: document `GOOGLE_APPLICATION_CREDENTIALS` with setup instructions

## v2.1.2 — Complete gateway command set ✅ complete

- [x] gateway: `/task` command — Telegram, Slack, Discord. Full form + short form (OURO_REPO_ROOT default)
- [x] gateway: `/feedback` command — Telegram, Slack, Discord. Enqueues to ouro_feedback
- [x] gateway: `/logs` command — Telegram, Slack, Discord. Last 10 ouro_logs entries
- [x] gateway: `/mcp` command added to Discord (already in Telegram). Discord now at full parity
- [x] spec/05-gateway.md: command table updated to reflect all implemented commands
- [x] Tests: 7 new tests. gateway: 129 tests. Total: 496

## v2.1.1 — Discord /mcp parity + env/doc housekeeping ✅ complete

- [x] gateway: add `/mcp` slash command to DiscordAdapter — lists registered MCPs with status and tools (parity with Telegram)
- [x] Tests: 1 new Discord /mcp test. gateway: 118 tests. Total: 485
- [x] chore: complete env var list in CLAUDE.md and .env.example (PORT_GATEWAY, AWS vars, OURO_SCHEDULER_INTERVAL_MS, OURO_OIDC_ISSUER, GOOGLE_APPLICATION_CREDENTIALS)
- [x] docs: remove "stub v1" labels from S3/GDrive/OneDrive worker backend specs (all are fully implemented)
- [x] docs: update spec/06-mcp-factory.md — gdrive row updated to v1 with correct package and config example

## v2.1.3 — Slack command parity ✅ complete

- [x] gateway: add `/status`, `/jobs`, `/mcp` commands to SlackAdapter — Slack now has full parity with Telegram and Discord (8 commands each)
- [x] Tests: 3 new Slack command tests. gateway: 132 tests. Total: 499

## v2.2.0 — S3 MCP backend ✅ complete

- [x] mcp-factory: implement `s3` scheme in `generateConfig` — uses `mcp-server-s3` with AWS credential chain passthrough (`AWS_ACCESS_KEY_ID`/`SECRET`/`REGION` or `AWS_PROFILE` from env; falls back to `~/.aws/credentials` and IAM role)
- [x] mcp-factory: add `s3` validation prompt to `VALIDATION_PROMPTS` in `validate.ts`
- [x] mcp-factory: 3 new `generateConfig` tests for s3; remove s3 from stub scheme list
- [x] spec/06-mcp-factory.md: s3 row updated to v1 with correct package (`mcp-server-s3`) and config example
- [x] spec/07-open-questions.md: S3 moved from stubbed to fully implemented

## v2.3.0 — OneDrive MCP backend ✅ complete

- [x] mcp-factory: implement `onedrive` scheme in `generateConfig` — uses `@pnp/cli-microsoft365-mcp-server` with Azure service principal credentials (`MICROSOFT_CLIENT_ID`/`SECRET`/`TENANT_ID` from env)
- [x] mcp-factory: add `onedrive` validation prompt to `VALIDATION_PROMPTS` in `validate.ts`
- [x] mcp-factory: 3 new `generateConfig` tests for onedrive; remove onedrive from stub scheme list
- [x] spec/06-mcp-factory.md: onedrive row updated to v1 with correct package and auth model
- [x] spec/07-open-questions.md: OneDrive moved from stubbed to fully implemented
- [x] `.env.example`: document `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` with Azure AD setup instructions

## v2.3.1 — housekeeping ✅ complete

- [x] meta-agent/coordinator: bump version string from v2.1.3 → v2.3.0
- [x] spec/06-mcp-factory.md: add missing onedrive config example to Generated Configs section

## v2.3.2 — fix: chat adapter approve/reject publishes ouro_notify ✅ complete

- [x] gateway/telegram: publish `evolution_approved` / `evolution_rejected` to `ouro_notify` on success
- [x] gateway/slack: same fix
- [x] gateway/discord: same fix
- [x] Tests: 6 new publish assertions in adapter success cases

## v2.3.3 — Discord slash command auto-registration ✅ complete

- [x] gateway/discord: `DISCORD_APPLICATION_ID` env var — enables slash command registration on startup
- [x] gateway/discord: `registerCommands()` public method — calls `PUT /applications/{appId}/commands` with all 8 commands
- [x] gateway/discord: private `request(method, url, body, headers)` helper — `post` and new `put` delegate to it
- [x] gateway/index: pass `DISCORD_APPLICATION_ID` as 4th arg to `DiscordAdapter` constructor
- [x] `.env.example`: document `DISCORD_APPLICATION_ID` with portal link instructions
- [x] CLAUDE.md: add `DISCORD_APPLICATION_ID` to env vars table
- [x] Tests: 5 new tests (start calls registerCommands, start skips without appId, failure logged, PUT payload, no-op without appId). gateway: 137 tests. Total: 511
- [x] chore: bump all package.json + internal version strings to 2.3.3

## v2.3.4 — watchdog data retention + pruning index ✅ complete

- [x] meta-agent/watchdog: `pruneOldData()` step added to `watchdogTick` — deletes `ouro_logs` older than 30 days and `ouro_job_output` for completed/failed/cancelled jobs older than 7 days; each DELETE counts rows and logs only when something is pruned; errors caught independently so one failure does not block the other
- [x] Tests: 5 new watchdog prune tests (log prune count, output prune count, log error continues, output error continues, no-log when nothing pruned). meta-agent: 117 tests. Total: 516
- [x] core: migration `006_pruning_indexes.sql` — partial index on `ouro_jobs(status, completed_at)` so the watchdog prune subquery uses an index scan instead of a full seq scan on long-running installs

## v2.3.5 — evolution restart resume ✅ complete

- [x] meta-agent/evolution: `startEvolution()` queries `ouro_feedback WHERE status='pr_open' AND queue_msg_id IS NOT NULL` on startup — resumes `pollForApproval` for any in-flight PRs so approval polling survives process restarts
- [x] core: migration `005_feedback_msg_id.sql` — `queue_msg_id BIGINT` column on `ouro_feedback`; `processOneFeedback` writes `msgId` to DB before spawning poller
- [x] Tests: adapted `startEvolution` tests to mock the DB resume query. meta-agent: 117 tests.

## v2.3.5-housekeeping ✅ complete

- [x] chore: bump all package.json versions 2.3.3 → 2.3.5
- [x] coordinator.ts: version string updated to v2.3.5
- [x] CHANGELOG.md: add missing entries for v2.3.3, v2.3.4, v2.3.5

## v2.3.6 — evolution timeout: close PR + set timed_out status ✅ complete

- [x] meta-agent/evolution: `pollForApproval` now distinguishes "row not found" (orphaned message) from "7-day deadline expired". On timeout: close the GitHub PR via claude subprocess, update `ouro_feedback.status = 'timed_out'`, publish `evolution_timeout` event. Previously the PR was left open and the row was stuck at `pr_open` forever.
- [x] Tests: 1 new test (closes PR, sets timed_out, publishes event on deadline). meta-agent: 118 tests. Total: 517
- [x] chore: bump all package versions to 2.3.6

## Pending

- [ ] Push main branch to origin — requires human action
- [ ] npm publish: run `pnpm -r publish --access public` once org namespace `@ouroboros` is claimed
