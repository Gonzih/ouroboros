# Plan: packages/mcp-server — Ouroboros Control Plane MCP

## Task Restatement

Build `packages/mcp-server`: a stdio MCP server that exposes Ouroboros internals (jobs, MCP registry, feedback, logs) as tools Claude can call. This closes the v0.2 cycling loop — Claude becomes the coordinator rather than a passive subagent.

## Key Findings

- MCP SDK latest stable: `@modelcontextprotocol/sdk@1.29.0`
- Worker-dispatch expects pgmq messages shaped as `{ id, backend, target, instructions }`
- `getDb()` returns `postgres.Sql` with tagged-template query interface
- DB columns are snake_case; TypeScript interfaces are camelCase — return raw JSON from queries
- All packages use `"type": "module"`, Node16 resolution, `.js` imports
- `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` — array[0] needs null check; no `obj.prop = undefined`
- `@types/node@22.10.7` provides global `fetch` — no import needed
- Vitest pattern: `vi.mock('@ouroboros/core', ...)` + `mockGetDb.mockReturnValue(mockDbFn)`
- PORT_MCP_FACTORY defaults to 7703

## Approach

Implement exactly per spec: stdio transport, 14 tools across 4 tool modules, JSON Schema (no zod), raw pg queries, `fetch` for mcp-factory HTTP calls. Tests mock `@ouroboros/core` and global `fetch`.

## Files to Create

| File | Purpose |
|------|---------|
| `packages/mcp-server/package.json` | Package config, MCP SDK dep |
| `packages/mcp-server/tsconfig.json` | Extends base tsconfig |
| `packages/mcp-server/vitest.config.ts` | Test config |
| `packages/mcp-server/src/tools/jobs.ts` | list_jobs, get_job_output, get_job_status, spawn_worker, cancel_job |
| `packages/mcp-server/src/tools/mcp.ts` | list_mcps, register_mcp, delete_mcp, test_mcp |
| `packages/mcp-server/src/tools/feedback.ts` | submit_feedback, list_feedback, approve_evolution, reject_evolution |
| `packages/mcp-server/src/tools/logs.ts` | get_logs |
| `packages/mcp-server/src/server.ts` | MCP Server wiring |
| `packages/mcp-server/src/index.ts` | Entry point (migrate + startServer) |
| `packages/mcp-server/src/__tests__/tools.test.ts` | Unit tests |
| `claude-control.json` | MCP config for `claude --mcp-config` |

## Risks

- MCP SDK import paths may differ in v1.29.0 vs what spec assumes — fix during build
- `exactOptionalPropertyTypes` requires care when building insert objects with optional fields
- `postgres.js` tagged templates with null parameters need to be tested — use NULL conditionals from spec
