import { migrate, tryAcquireLock, releaseLock, closeDb, getDb, log } from '@ouroboros/core'
import { startMcpWatch } from './loops/mcp-watch.js'
import { startWorkerDispatch } from './loops/worker-dispatch.js'
import { startEvolution } from './loops/evolution.js'
import { watchdogLoop, makeMetaAgentState } from './loops/watchdog.js'
import { spawnCoordinator } from './coordinator.js'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function runCoordinatorLoop(): Promise<void> {
  while (true) {
    let didWork = false
    try {
      const proc = await spawnCoordinator()
      proc.stdout?.on('data', (data: Buffer) => {
        if (data.toString().includes('[coordinator:did-work]')) didWork = true
      })
      await new Promise<void>(resolve => proc.once('exit', () => resolve()))
      if (didWork) {
        await log('meta-agent', '[coordinator:did-work] detected')
      } else {
        await log('meta-agent', 'Coordinator cycle idle — no actions taken')
      }
    } catch (err) {
      await log('meta-agent', `Coordinator spawn error: ${String(err)}`)
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
      watchdogLoop(state),
    ])
  } else {
    await log('meta-agent', 'Running in coordinator mode (v0.2)')
    await Promise.all([
      watchdogLoop(state),
      runCoordinatorLoop(),
    ])
  }
}
