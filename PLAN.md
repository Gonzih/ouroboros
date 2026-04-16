# PLAN: packages/meta-agent — Full Implementation

## Task Restatement
Implement the always-on coordinator in `packages/meta-agent`. Three concurrent loops driven by Postgres: (1) MCP registry watch via LISTEN/NOTIFY, (2) worker dispatch via pgmq polling, (3) self-evolution via feedback queue + claude subprocess. Postgres advisory lock enforces singleton. Cross-platform claude binary finder. No launchd or platform-specific assumptions.

## Approaches Considered

### A: Monolithic index.ts (all loops inline)
All three loops in a single file. Simple but unmaintainable and untestable.

### B: One file per loop in src/loops/ + src/claude.ts utility (chosen)
Each loop is a separate module. `index.ts` orchestrates. Matches the spec's file layout exactly and follows existing worker package structure.

### C: Event-driven loop manager with shared state object
Centralized state object passed between loops. Over-engineered for v1 — simple module-level state is sufficient.

## Chosen Approach: B
Clean separation of concerns. Each loop is independently readable and testable. Matches spec exactly.

## Files to Touch
- `packages/meta-agent/src/claude.ts` (create — cross-platform claude binary finder)
- `packages/meta-agent/src/loops/mcp-watch.ts` (create — LISTEN/NOTIFY subscriber)
- `packages/meta-agent/src/loops/worker-dispatch.ts` (create — pgmq poll + child_process spawn)
- `packages/meta-agent/src/loops/evolution.ts` (create — feedback poll + spawnSync claude + approval gate)
- `packages/meta-agent/src/index.ts` (overwrite stub — startup, lock, crash recovery, loop orchestration)
- `packages/meta-agent/src/test/meta-agent.test.ts` (create — unit tests for claude finder and task validation)

## Key Design Decisions
- `workerBin` resolved from `OURO_REPO_ROOT` env var: `path.join(OURO_REPO_ROOT, 'packages/worker/dist/index.js')`
- Evolution dequeue uses 7-day visibility timeout so message stays invisible during approval wait
- Active workers tracked in `Map<string, ChildProcess>` module-level, not shared across loops
- On MAX_WORKERS reached: nack task immediately so another instance (or future poll) can handle it
- stdout/stderr of worker subprocess streamed line-by-line to ouro_job_output via readline
- Claude binary finder checks env var first, then platform-specific paths, falls back to 'claude'
- ESM imports use `.js` extension (Node16 module resolution)
- All array accesses guarded due to `noUncheckedIndexedAccess: true`

## Risks & Unknowns
- Worker subprocess path: if OURO_REPO_ROOT is unset, derive from `import.meta.url`
- Evolution polling loop (up to 7 days) — runs as a background async function per feedback item
- If meta-agent crashes mid-evolution, pr_open items won't be re-polled until restart; acceptable for v1
- `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` — must be careful with all property access
- The worker also inserts to ouro_job_output internally — meta-agent will produce duplicates; known v1 limitation per spec
