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

## Pending

- [ ] Push main branch to origin (currently 6 commits ahead of remote) — requires human action
- [ ] npm publish: run `pnpm -r publish --access public` once org namespace `@ouroboros` is claimed

## v0.6.0 — Integration test suite + Gateway rate limiting ✅ complete

- [x] gateway: request rate limiting on `/approve/:id` and `/reject/:id` (prevent duplicate approval spam)
- [x] gateway: idempotency key check — reject double-approval of same feedback id with 409
- [x] Test: end-to-end approval flow — POST /approve/:id → DB state change → ouro_notify event published
- [x] Test: OIDC middleware integration test — verifies discovery-doc fetch path via mocked fetch
- [x] meta-agent: configurable watchdog interval via `OURO_WATCHDOG_INTERVAL_MS` env var (was hardcoded 60s)
