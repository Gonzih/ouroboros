import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import {
  getDb,
  publish,
  log,
  registerProcess,
  unregisterProcess,
  setJobSession,
  setJobHeartbeat,
  heartbeat,
} from '@ouroboros/core'
import type { StorageBackend } from './backends/interface.js'
import { gitBackend } from './backends/git.js'
import { localBackend } from './backends/local.js'
import { s3Backend } from './backends/s3.js'
import { gdriveBackend } from './backends/gdrive.js'
import { onedriveBackend } from './backends/onedrive.js'

interface TaskInput {
  id: string
  backend: string
  target: string
  instructions: string
  sessionId?: string
}

function selectBackend(name: string): StorageBackend {
  switch (name) {
    case 'git': return gitBackend
    case 'local': return localBackend
    case 's3': return s3Backend
    case 'gdrive': return gdriveBackend
    case 'onedrive': return onedriveBackend
    default: throw new Error(`unknown backend: ${name}`)
  }
}

async function insertOutputLine(jobId: string, line: string): Promise<void> {
  try {
    const db = getDb()
    await db`INSERT INTO ouro_job_output (job_id, line) VALUES (${jobId}, ${line})`
    await publish('ouro_notify', { type: 'job_output_appended', jobId, line })
  } catch (err) {
    process.stderr.write(`[worker] failed to insert output line: ${String(err)}\n`)
  }
}

async function updateJobStatus(
  jobId: string,
  status: string,
  extra: Record<string, string> = {}
): Promise<void> {
  const db = getDb()
  if (status === 'running') {
    await db`UPDATE ouro_jobs SET status = 'running', started_at = NOW() WHERE id = ${jobId}`
  } else if (status === 'completed') {
    await db`UPDATE ouro_jobs SET status = 'completed', completed_at = NOW() WHERE id = ${jobId}`
  } else if (status === 'failed') {
    const error = extra['error'] ?? 'unknown error'
    await db`UPDATE ouro_jobs SET status = 'failed', completed_at = NOW(), error = ${error} WHERE id = ${jobId}`
  }
}

export async function run(): Promise<void> {
  const raw = process.env['OURO_TASK']
  if (!raw) throw new Error('OURO_TASK env var is required')

  let task: TaskInput
  try {
    task = JSON.parse(raw) as TaskInput
  } catch {
    throw new Error(`failed to parse OURO_TASK: ${raw}`)
  }

  const { id, backend: backendName, target, instructions, sessionId: existingSessionId } = task
  const backend = selectBackend(backendName)

  await log('worker', `starting job ${id} (backend=${backendName}, target=${target})`)
  await updateJobStatus(id, 'running')

  // Register this worker process and record the PID on the job
  const procName = `worker:${id}`
  await registerProcess(procName, process.pid, 'node', [])
  const newSessionId = randomUUID()
  await setJobSession(id, process.pid, existingSessionId ?? newSessionId)

  // Heartbeat: update ouro_jobs.last_heartbeat and ouro_processes.last_heartbeat every 30s
  const heartbeatInterval = setInterval(() => {
    void setJobHeartbeat(id).catch(() => undefined)
    void heartbeat(procName).catch(() => undefined)
  }, 30_000)

  let workdir: string | null = null
  let finalStatus: 'completed' | 'failed' = 'failed'
  let failReason = 'unknown'

  try {
    workdir = await backend.prepare(target, id)
    await log('worker', `prepared workdir: ${workdir}`)

    const prompt = [
      `You have been given this task: ${instructions}`,
      '',
      `You are operating in: ${workdir}`,
      'Available MCP tools are configured in your environment.',
      '',
      'Complete the task. When done, respond with exactly: TASK_DONE',
      'If you cannot complete it, respond with exactly: TASK_FAILED:{reason}',
    ].join('\n')

    // Use --continue when resuming an interrupted session (sessionId was set by prior run)
    const claudeArgs: string[] = existingSessionId !== undefined
      ? ['--continue', '--dangerously-skip-permissions']
      : ['--print', '--dangerously-skip-permissions', '-p', prompt]

    const outputLines: string[] = []
    let taskDone = false
    let taskFailed = false
    let taskFailedReason = ''
    let lastOutputAt = Date.now()

    const idleTimer = setInterval(async () => {
      const idleSecs = Math.floor((Date.now() - lastOutputAt) / 1000)
      if (idleSecs >= 600) {
        const msg = `worker: still running (no output for ${idleSecs}s)`
        await insertOutputLine(id, msg)
        await log('worker', msg)
      }
    }, 60_000)

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        'claude',
        claudeArgs,
        {
          cwd: workdir!,
          env: { ...process.env },
        }
      )

      const rl = createInterface({ input: proc.stdout })
      rl.on('line', async (line) => {
        lastOutputAt = Date.now()
        outputLines.push(line)
        process.stdout.write(line + '\n')
        await insertOutputLine(id, line)
        if (line.trim() === 'TASK_DONE') {
          taskDone = true
        } else if (line.trim().startsWith('TASK_FAILED:')) {
          taskFailed = true
          taskFailedReason = line.trim().slice('TASK_FAILED:'.length)
        }
      })

      const stderrLines: string[] = []
      const rlErr = createInterface({ input: proc.stderr })
      rlErr.on('line', (line) => {
        stderrLines.push(line)
        process.stderr.write(line + '\n')
      })

      proc.on('error', reject)
      proc.on('close', (code) => {
        clearInterval(idleTimer)
        if (code === 0) {
          resolve()
        } else {
          const lastErr = stderrLines[stderrLines.length - 1] ?? `claude exited with code ${code ?? 'unknown'}`
          reject(new Error(lastErr))
        }
      })
    })

    if (taskFailed) {
      finalStatus = 'failed'
      failReason = taskFailedReason || 'task reported failure'
    } else if (taskDone || outputLines.length > 0) {
      // Commit changes
      const commitMsg = instructions.slice(0, 60)
      await backend.commit(workdir, `ouro task ${id}: ${commitMsg}`)
      finalStatus = 'completed'
    } else {
      finalStatus = 'failed'
      failReason = 'no output from claude'
    }
  } catch (err) {
    finalStatus = 'failed'
    failReason = String(err instanceof Error ? err.message : err)
    await log('worker', `job ${id} failed: ${failReason}`)
  } finally {
    clearInterval(heartbeatInterval)
    await unregisterProcess(procName).catch(() => undefined)
    if (workdir !== null) {
      try {
        await backend.cleanup(workdir)
      } catch (cleanupErr) {
        await log('worker', `cleanup failed for ${workdir}: ${String(cleanupErr)}`)
      }
    }
  }

  if (finalStatus === 'completed') {
    await updateJobStatus(id, 'completed')
    await log('worker', `job ${id} completed`)
  } else {
    await updateJobStatus(id, 'failed', { error: failReason })
    await log('worker', `job ${id} failed: ${failReason}`)
  }

  await publish('ouro_notify', { type: 'job_complete', jobId: id, status: finalStatus })
}
