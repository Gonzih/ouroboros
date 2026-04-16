# 08 — Self-Healing, Watchdog, and Session Continuity

## Overview

Ouroboros must survive crashes, network interruptions, and code-change restarts without losing in-flight work. Three mechanisms achieve this:

1. **Loop 4 — Watchdog**: detects dead worker PIDs every 60s, resets stale jobs to pending, requeues with `sessionId` for `--continue` resume.
2. **Worker session continuity**: workers register PIDs and emit 30s heartbeats; on resume they use `--continue` so Claude resumes the interrupted session.
3. **Post-evolution self-restart**: after an approved feedback PR is merged and rebuilt, meta-agent exits cleanly so the supervisor respawns with the new binary.

---

## Schema Additions (`migrations/002_self_healing.sql`)

```sql
-- ouro_jobs tracking
ALTER TABLE ouro_jobs ADD COLUMN IF NOT EXISTS pid INTEGER;
ALTER TABLE ouro_jobs ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE ouro_jobs ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMPTZ;

-- Service process registry
CREATE TABLE IF NOT EXISTS ouro_processes (
  name           TEXT PRIMARY KEY,   -- 'gateway', 'ui', 'worker:{jobId}'
  pid            INTEGER NOT NULL,
  command        TEXT NOT NULL,
  args           TEXT[] NOT NULL DEFAULT '{}',
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

`ouro_jobs.pid` + `last_heartbeat` are the watchdog's detection signals.
`ouro_jobs.session_id` is passed through requeue so the resumed worker can call `--continue`.
`ouro_processes` tracks service-level processes (gateway, ui) for restart detection.

---

## Loop 4 — Watchdog (`packages/meta-agent/src/loops/watchdog.ts`)

Runs every 60 seconds inside meta-agent (fourth member of the `Promise.all` array).

### Stale job detection

1. Query `ouro_jobs WHERE status='running' AND last_heartbeat < NOW() - 10 min`
2. For each: check `isPidAlive(job.pid)` — if dead:
   - UPDATE job to `status='pending', pid=NULL, last_heartbeat=NULL, started_at=NULL`
   - Re-enqueue to `ouro_tasks` with `sessionId` (so worker uses `--continue`)
   - Publish `{ type: 'job_requeued', jobId, reason: 'watchdog_dead_pid' }`

**Why not hard-kill the old process?** The old worker process may still be writing output. We only reset DB state and let the worker die naturally. The new worker will resume where the session left off.

### Service restart detection

1. Query `ouro_processes WHERE name IN ('gateway', 'ui')`
2. For each: if `isPidAlive(pid)` is false:
   - Unregister from `ouro_processes`
   - Call `state.restartService(name, command, args)` — spawns new subprocess, registers PID

### PID liveness check

```typescript
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)  // signal 0 = existence check, no real signal sent
    return true
  } catch (err) {
    // EPERM: process exists but we can't signal it → still alive
    // ESRCH: process does not exist → dead
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'EPERM') {
      return true
    }
    return false
  }
}
```

**Cross-platform**: On macOS and Linux, `kill(pid, 0)` throws `ESRCH` for non-existent processes. On Windows, Node.js maps this to an equivalent existence check without sending a POSIX signal.

---

## Worker Session Continuity (`packages/worker/src/run.ts`)

### On first dispatch

```typescript
await registerProcess(`worker:${jobId}`, process.pid, 'node', [])
const newSessionId = randomUUID()
await setJobSession(jobId, process.pid, existingSessionId ?? newSessionId)
```

A `sessionId` is stored on the job immediately. If the worker is killed and requeued, this value is included in the task message.

### Heartbeat every 30s

```typescript
const heartbeatInterval = setInterval(() => {
  void setJobHeartbeat(jobId)
  void heartbeat(`worker:${jobId}`)
}, 30_000)
```

Cleared in `finally` along with `unregisterProcess`.

### Resume with `--continue`

```typescript
const claudeArgs = existingSessionId !== undefined
  ? ['--continue', '--dangerously-skip-permissions']
  : ['--print', '--dangerously-skip-permissions', '-p', prompt]
```

`--continue` resumes Claude's last session from the same working directory (`target`). The working directory must be preserved between runs — the watchdog passes `job.target` through the requeued message so the worker uses it as `cwd`.

---

## Post-Evolution Self-Restart (`packages/meta-agent/src/loops/evolution.ts`)

After a feedback PR is merged and `status='applied'`:

```
1. pnpm build (in OURO_REPO_ROOT)
2. If build fails: log error, publish rebuild_failed, RETURN (keep old binary running)
3. If build succeeds:
   - Publish { type: 'restarting', reason: 'evolution_applied' }
   - releaseLock('ouro:meta-agent')  ← so the new process can acquire it
   - sleep(2000)                     ← give gateway time to broadcast restart msg
   - process.exit(0)                 ← supervisor (launchd/systemd) respawns
```

**Never restart on build failure** — the running binary is still valid; crashing it would leave the system with no coordinator.

---

## Process Registry API (`packages/core/src/process-registry.ts`)

| Function | Description |
|---|---|
| `registerProcess(name, pid, command, args)` | Upsert into `ouro_processes` |
| `unregisterProcess(name)` | Delete from `ouro_processes` |
| `heartbeat(name)` | UPDATE `last_heartbeat = NOW()` |
| `getStaleProcesses(staleAfterMs)` | Rows where `last_heartbeat` is stale |
| `setJobSession(jobId, pid, sessionId?)` | Record PID (+ optional sessionId) on job |
| `setJobHeartbeat(jobId)` | UPDATE `ouro_jobs.last_heartbeat = NOW()` |
| `getStaleJobs(staleAfterMs)` | Running jobs with stale heartbeat → `Job[]` |

---

## Supervisor Integration

Meta-agent relies on an external supervisor (launchd on macOS, systemd on Linux, NSSM on Windows) to respawn on exit. The `process.exit(0)` in the evolution loop is intentional — it signals the supervisor to restart, not a crash.

Gateway and UI are separate processes not currently spawned by meta-agent. When registered in `ouro_processes` by their own startup code, the watchdog can detect and restart them.
