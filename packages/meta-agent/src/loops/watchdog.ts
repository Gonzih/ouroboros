import { spawn } from 'node:child_process'
import { getDb, log, publish, enqueue, unregisterProcess, getStaleJobs, registerProcess } from '@ouroboros/core'

export interface MetaAgentState {
  restartService(name: string, command: string, args: string[]): void
}

// Cross-platform liveness check: signal 0 tests existence without sending a real signal.
// On Windows, Node.js translates this to a process-existence check.
// EPERM = process exists but we can't signal it (still alive).
// ESRCH = process does not exist.
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EPERM') {
      return true
    }
    return false
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const WATCHDOG_INTERVAL_MS = parseInt(process.env['OURO_WATCHDOG_INTERVAL_MS'] ?? '60000', 10)

export async function watchdogLoop(state: MetaAgentState): Promise<void> {
  while (true) {
    await sleep(WATCHDOG_INTERVAL_MS)

    // 1. Find stale running jobs (no heartbeat > 10 min)
    try {
      const staleJobs = await getStaleJobs(10 * 60 * 1000)
      for (const job of staleJobs) {
        const alive = job.pid !== undefined ? isPidAlive(job.pid) : false
        if (!alive) {
          await log('watchdog', `Job ${job.id} PID ${String(job.pid ?? 'none')} dead — resetting to pending`)
          const db = getDb()
          await db`
            UPDATE ouro_jobs
            SET status = 'pending', pid = NULL, last_heartbeat = NULL, started_at = NULL
            WHERE id = ${job.id}
          `
          // Requeue with sessionId so worker uses --continue on resume
          await enqueue('ouro_tasks', {
            id: job.id,
            backend: job.backend,
            target: job.target,
            instructions: job.description,
            ...(job.sessionId !== undefined ? { sessionId: job.sessionId } : {}),
          })
          await publish('ouro_notify', { type: 'job_requeued', jobId: job.id, reason: 'watchdog_dead_pid' })
        }
      }
    } catch (err) {
      await log('watchdog', `stale job check failed: ${String(err)}`)
    }

    // 2. Check registered services (gateway, ui) — restart if dead
    try {
      const db = getDb()
      const services = await db<{ name: string; pid: number; command: string; args: string[] }[]>`
        SELECT name, pid, command, args FROM ouro_processes
        WHERE name IN ('gateway', 'ui')
      `
      for (const svc of services) {
        if (!isPidAlive(svc.pid)) {
          await log('watchdog', `Service ${svc.name} PID ${svc.pid} dead — restarting`)
          await unregisterProcess(svc.name)
          state.restartService(svc.name, svc.command, svc.args)
        }
      }
    } catch (err) {
      await log('watchdog', `service check failed: ${String(err)}`)
    }
  }
}

// Factory for the MetaAgentState implementation used in production
export function makeMetaAgentState(): MetaAgentState {
  return {
    restartService(name: string, command: string, args: string[]): void {
      const proc = spawn(command, args, { detached: false })
      const pid = proc.pid ?? 0
      void log('meta-agent', `restarted service ${name} (PID ${pid})`)
      if (pid > 0) {
        void registerProcess(name, pid, command, args)
      }
    },
  }
}
