import { migrate, tryAcquireLock, releaseLock, closeDb, getDb, log } from '@ouroboros/core'
import { startMcpWatch } from './loops/mcp-watch.js'
import { startWorkerDispatch } from './loops/worker-dispatch.js'
import { startEvolution } from './loops/evolution.js'
import { startScheduler } from './loops/scheduler.js'
import { watchdogLoop, makeMetaAgentState } from './loops/watchdog.js'
import { spawnCoordinator, clearSessionId, loadSessionId, isValidUUID } from './coordinator.js'

// Coordinator exits with no stdout output → session was stale/expired, clear it.
// Time alone is unreliable: healthy cycles can complete in <10s. Output presence is
// the real signal — if the coordinator produced any output it did real work.
const FAST_EXIT_THRESHOLD_MS = 8_000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function runCoordinatorLoop(): Promise<void> {
  while (true) {
    const spawnedAt = Date.now()
    let hadOutput = false
    try {
      const proc = await spawnCoordinator()
      // spawnCoordinator already attaches a data listener for logging; we add a
      // second one here just to track whether any output arrived.
      proc.stdout?.on('data', () => { hadOutput = true })
      await new Promise<void>(resolve => proc.once('exit', () => resolve()))
    } catch (err) {
      await log('meta-agent', `Coordinator spawn error: ${String(err)}`)
    }
    // Clear the session only when the coordinator produced no output AND exited
    // suspiciously fast — strong signal that the session ID was stale.
    const elapsed = Date.now() - spawnedAt
    if (!hadOutput && elapsed < FAST_EXIT_THRESHOLD_MS) {
      const sid = loadSessionId()
      if (sid) {
        const label = isValidUUID(sid) ? `stale session ${sid}` : `legacy session marker ("${sid}")`
        await log('meta-agent', `Coordinator exited after ${elapsed}ms with no output — clearing ${label}`)
        clearSessionId()
      }
    }
    await log('meta-agent', 'Coordinator exited — restarting in 5s')
    await sleep(5000)
  }
}

export async function start(): Promise<void> {
  await migrate()

  const locked = await tryAcquireLock('ouro:meta-agent')
  if (!locked) {
    console.log('meta-agent: another instance is running — exiting')
    process.exit(0)
  }

  // Crash recovery: jobs that were running when we last died must be retried
  await getDb()`
    UPDATE ouro_jobs SET status = 'pending', started_at = NULL
    WHERE status = 'running'
  `

  const shutdown = async (): Promise<void> => {
    await log('meta-agent', 'shutting down')
    await releaseLock('ouro:meta-agent')
    await closeDb()
    process.exit(0)
  }
  process.once('SIGTERM', () => { void shutdown() })
  process.once('SIGINT', () => { void shutdown() })

  await log('meta-agent', `started (PID ${process.pid})`)

  const state = makeMetaAgentState()
  const legacyMode = process.env['OURO_LEGACY_LOOPS'] === 'true'

  if (legacyMode) {
    await log('meta-agent', 'Running in legacy loop mode (v0.1)')
    await Promise.all([
      startMcpWatch(),
      startWorkerDispatch(),
      startEvolution(),
      startScheduler(),
      watchdogLoop(state),
    ])
  } else {
    await log('meta-agent', 'Running in coordinator mode (v0.2)')
    await Promise.all([
      startMcpWatch(),
      startWorkerDispatch(),
      startEvolution(),
      startScheduler(),
      watchdogLoop(state),
      runCoordinatorLoop(),
    ])
  }
}

void start()
