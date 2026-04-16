# Plan: Self-Healing, Watchdog Loop, --continue Session Continuity

## Task Restatement

Add three complementary resilience features to Ouroboros:
1. **Loop 4 (watchdog)**: 60s poll that detects dead worker PIDs and stale service processes, resets jobs to pending, and requeues with session_id so they can resume.
2. **Worker session continuity**: Workers register their PID, emit 30s heartbeats, and use `--continue` when the task includes a `sessionId` from a prior interrupted run.
3. **Post-evolution self-restart**: After a feedback PR is merged and built successfully, meta-agent does a graceful exit so the supervisor respawns with the new binary.

## Approaches Considered

### A. Heartbeat via advisory locks (rejected)
Use a transient advisory lock that needs periodic renewal as the liveness signal. Clean on paper but advisory locks in postgres.js require a dedicated connection — incompatible with the singleton `getDb()` pattern.

### B. External process monitor (rejected)
A separate supervisor process checks PIDs. Adds a new process dependency, complicates deployment, and duplicates work the meta-agent coordinator already owns.

### C. Heartbeat timestamps in Postgres + in-process watchdog loop (chosen)
- Workers write `last_heartbeat = NOW()` every 30s into `ouro_jobs`
- Service processes write to `ouro_processes` table
- Watchdog loop inside meta-agent polls every 60s
- No extra dependencies, fits existing Postgres-only constraint

## Files to Touch

| File | Action |
|---|---|
| `packages/core/src/migrations/002_self_healing.sql` | New — process tracking columns + ouro_processes table |
| `packages/core/src/process-registry.ts` | New — 7 exported functions |
| `packages/core/src/types.ts` | Extend Job with pid/sessionId/lastHeartbeat |
| `packages/core/src/index.ts` | Re-export process-registry |
| `packages/meta-agent/src/loops/watchdog.ts` | New — Loop 4 |
| `packages/meta-agent/src/index.ts` | Add watchdog + MetaAgentState |
| `packages/meta-agent/src/loops/evolution.ts` | Add rebuild+restart after applied |
| `packages/worker/src/run.ts` | Heartbeats, PID registration, --continue |
| `packages/core/src/__tests__/process-registry.test.ts` | New tests |
| `packages/meta-agent/src/__tests__/watchdog.test.ts` | New tests |
| `spec/08-self-healing.md` | New spec doc |

## Risks

- `process.kill(pid, 0)` on Windows: Node.js normalises this — checks existence without sending a signal. Safe cross-platform.
- `--continue` in claude CLI resumes the last session from the cwd. Must use the same `target` (cwd) for both initial and resume runs.
- Build failure guard: never restart if `pnpm build` fails — keep running old binary.
- `exactOptionalPropertyTypes: true` — can't assign `undefined` to optional fields; use conditional assignment.
