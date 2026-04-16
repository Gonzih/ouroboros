import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dequeue, ack, nack, getDb, log, publish } from '@ouroboros/core'

interface TaskInput {
  id: string
  backend: string
  target: string
  instructions: string
}

function isValidTask(v: unknown): v is TaskInput {
  if (typeof v !== 'object' || v === null) return false
  const t = v as Record<string, unknown>
  return (
    typeof t['id'] === 'string' &&
    typeof t['backend'] === 'string' &&
    typeof t['target'] === 'string' &&
    typeof t['instructions'] === 'string'
  )
}

function resolveWorkerBin(): string {
  const repoRoot = process.env['OURO_REPO_ROOT']
  if (repoRoot) {
    return join(repoRoot, 'packages', 'worker', 'dist', 'index.js')
  }
  // Derive from this file's location: meta-agent/src/loops → ../../../../worker/dist/index.js
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', '..', '..', 'worker', 'dist', 'index.js')
}

const activeWorkers = new Map<string, ChildProcess>()

async function insertOutputLine(jobId: string, line: string): Promise<void> {
  try {
    const db = getDb()
    await db`INSERT INTO ouro_job_output (job_id, line) VALUES (${jobId}, ${line})`
  } catch (err) {
    process.stderr.write(`[meta-agent:worker-dispatch] failed to insert output: ${String(err)}\n`)
  }
}

async function spawnWorker(
  workerBin: string,
  task: TaskInput,
  msgId: bigint,
): Promise<void> {
  const { id } = task

  activeWorkers.set(id, null as unknown as ChildProcess) // reserve slot before async work

  const proc = spawn('node', [workerBin], {
    env: { ...process.env, OURO_TASK: JSON.stringify(task) },
  })

  activeWorkers.set(id, proc)

  const rl = createInterface({ input: proc.stdout })
  rl.on('line', (line) => {
    void insertOutputLine(id, line)
  })

  const stderrLines: string[] = []
  const rlErr = createInterface({ input: proc.stderr })
  rlErr.on('line', (line) => {
    stderrLines.push(line)
    void insertOutputLine(id, `[stderr] ${line}`)
  })

  proc.on('close', (code) => {
    activeWorkers.delete(id)
    if (code === 0) {
      void ack('ouro_tasks', msgId).catch((err: unknown) =>
        log('meta-agent:worker-dispatch', `ack failed for job ${id}: ${String(err)}`),
      )
    } else {
      const lastErr =
        stderrLines[stderrLines.length - 1] ??
        `worker exited with code ${code ?? 'unknown'}`
      void log('meta-agent:worker-dispatch', `job ${id} failed: ${lastErr}`)
      void nack('ouro_tasks', msgId).catch((err: unknown) =>
        log('meta-agent:worker-dispatch', `nack failed for job ${id}: ${String(err)}`),
      )
      void publish('ouro_notify', { type: 'job_complete', jobId: id, status: 'failed' })
    }
  })

  proc.on('error', (err) => {
    activeWorkers.delete(id)
    void log('meta-agent:worker-dispatch', `failed to spawn worker for job ${id}: ${String(err)}`)
    void nack('ouro_tasks', msgId).catch(() => undefined)
  })
}

export async function startWorkerDispatch(): Promise<void> {
  const maxWorkers = parseInt(process.env['OURO_MAX_WORKERS'] ?? '3', 10)
  const workerBin = resolveWorkerBin()

  const poll = async (): Promise<void> => {
    try {
      if (activeWorkers.size >= maxWorkers) {
        // At limit — skip this tick
        return
      }

      const item = await dequeue<unknown>('ouro_tasks', 1800) // 30 min visibility
      if (!item) return

      const { msgId, message } = item

      if (!isValidTask(message)) {
        await log('meta-agent:worker-dispatch', `invalid task shape, nacking: ${JSON.stringify(message)}`)
        await nack('ouro_tasks', msgId)
        return
      }

      await log('meta-agent:worker-dispatch', `dispatching job ${message.id} (backend=${message.backend})`)
      await spawnWorker(workerBin, message, msgId)
    } catch (err) {
      await log('meta-agent:worker-dispatch', `poll error: ${String(err)}`)
    }
  }

  // Run poll loop indefinitely — never throws
  const run = (): void => {
    void poll().finally(() => {
      setTimeout(run, 2000)
    })
  }

  run()
  // Return a promise that never resolves — keeps the loop alive
  await new Promise<never>(() => undefined)
}
