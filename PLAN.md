# PLAN — Vitest Unit Tests Across All Packages

## Goal
Add Vitest unit tests to all 6 packages. All packages use ESM with Node16 module resolution and TypeScript strict mode.

## Approach
- Add vitest + @vitest/coverage-v8 to root devDependencies
- Each package gets vitest.config.ts and updated test script
- Use vi.mock() for all external dependencies

## Package-by-package

### core: queue.ts, locks.ts, types.ts
### mcp-factory: parse.ts, generate.ts, claude-json.ts, validate.ts
### worker: backends/git.ts, backends/local.ts
### meta-agent: claude.ts, loops/evolution.ts (regex/shape tests); exclude src/test/ node:test files
### gateway: all adapters + gateway.ts
### ui: extract app.ts from index.ts; test REST routes via supertest

---

# (Previous Plan) PLAN: packages/ui — Vue 3 Dashboard

## Task Summary
Implement `packages/ui`: a Vue 3 SPA with an Express + WebSocket backend serving on port 7702.
5 views (Dashboard, Jobs, Logs, Feedback, MCP Registry). Dark terminal CSS, no component library,
Pinia state management, live updates via WebSocket bridging Postgres LISTEN/NOTIFY.

## Approaches Considered

### A) Full SSR with Vue (Nuxt)
- Pro: SEO, fast first paint
- Con: Overkill for an internal tool, more complex build
- Rejected

### B) Separate frontend (Vite dev server) + separate API server
- Pro: Clean separation, fast HMR
- Con: Two processes, CORS complexity, harder to deploy
- Rejected

### C) Single Express server serving Vite-built static bundle + REST API + WebSocket (CHOSEN)
- Pro: One binary, one port (7702), simple to deploy and evolve
- Matches spec exactly, simplest production model

## Files to Create/Modify
- `packages/ui/package.json` — replace stub with full deps
- `packages/ui/tsconfig.json` — frontend (bundler resolution, DOM lib, noEmit)
- `packages/ui/tsconfig.server.json` — extends base, Node16 for server
- `packages/ui/vite.config.ts`
- `packages/ui/index.html`
- `packages/ui/server/index.ts` — Express + WS + REST API
- `packages/ui/src/main.ts` — replace stub
- `packages/ui/src/App.vue`
- `packages/ui/src/router/index.ts`
- `packages/ui/src/composables/useWebSocket.ts`
- `packages/ui/src/stores/jobs.ts`, `mcp.ts`, `logs.ts`, `feedback.ts`
- `packages/ui/src/views/Dashboard.vue`, `Jobs.vue`, `Logs.vue`, `Feedback.vue`, `McpRegistry.vue`
- `packages/ui/src/components/StatusBadge.vue`, `LiveOutput.vue`

## Risks
- `noUncheckedIndexedAccess`: all `req.params['x']` need `?? ''` fallbacks
- `exactOptionalPropertyTypes`: no `obj.prop = undefined`
- Server tsconfig must include ONLY `server/`, not `src/` (Vue SFCs break tsc)
- Existing `src/index.ts` stub → replaced by `src/main.ts`
