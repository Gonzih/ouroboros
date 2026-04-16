import { getDb } from './db.js'
import type { Job } from './types.js'

export async function registerProcess(
  name: string,
  pid: number,
  command: string,
  args: string[],
): Promise<void> {
  const db = getDb()
  await db`
    INSERT INTO ouro_processes (name, pid, command, args, started_at, last_heartbeat)
    VALUES (${name}, ${pid}, ${command}, ${args}, NOW(), NOW())
    ON CONFLICT (name) DO UPDATE
      SET pid            = EXCLUDED.pid,
          command        = EXCLUDED.command,
          args           = EXCLUDED.args,
          started_at     = EXCLUDED.started_at,
          last_heartbeat = EXCLUDED.last_heartbeat
  `
}

export async function unregisterProcess(name: string): Promise<void> {
  const db = getDb()
  await db`DELETE FROM ouro_processes WHERE name = ${name}`
}

export async function heartbeat(name: string): Promise<void> {
  const db = getDb()
  await db`UPDATE ouro_processes SET last_heartbeat = NOW() WHERE name = ${name}`
}

export async function getStaleProcesses(
  staleAfterMs: number,
): Promise<Array<{ name: string; pid: number }>> {
  const db = getDb()
  return db<{ name: string; pid: number }[]>`
    SELECT name, pid FROM ouro_processes
    WHERE last_heartbeat < NOW() - (${staleAfterMs} * INTERVAL '1 millisecond')
  `
}

export async function setJobSession(
  jobId: string,
  pid: number,
  sessionId?: string,
): Promise<void> {
  const db = getDb()
  if (sessionId !== undefined) {
    await db`
      UPDATE ouro_jobs
      SET pid = ${pid}, session_id = ${sessionId}, last_heartbeat = NOW()
      WHERE id = ${jobId}
    `
  } else {
    await db`
      UPDATE ouro_jobs
      SET pid = ${pid}, last_heartbeat = NOW()
      WHERE id = ${jobId}
    `
  }
}

export async function setJobHeartbeat(jobId: string): Promise<void> {
  const db = getDb()
  await db`UPDATE ouro_jobs SET last_heartbeat = NOW() WHERE id = ${jobId}`
}

export async function getStaleJobs(staleAfterMs: number): Promise<Job[]> {
  const db = getDb()
  const rows = await db<{
    id: string
    description: string
    backend: string
    target: string
    status: string
    created_at: Date
    started_at: Date | null
    completed_at: Date | null
    error: string | null
    pid: number | null
    session_id: string | null
    last_heartbeat: Date | null
  }[]>`
    SELECT
      id, description, backend, target, status,
      created_at, started_at, completed_at, error,
      pid, session_id, last_heartbeat
    FROM ouro_jobs
    WHERE status = 'running'
      AND last_heartbeat < NOW() - (${staleAfterMs} * INTERVAL '1 millisecond')
  `

  return rows.map(r => {
    const job: Job = {
      id: r.id,
      description: r.description,
      backend: r.backend as Job['backend'],
      target: r.target,
      status: r.status as Job['status'],
      createdAt: r.created_at,
    }
    if (r.started_at !== null) job.startedAt = r.started_at
    if (r.completed_at !== null) job.completedAt = r.completed_at
    if (r.error !== null) job.error = r.error
    if (r.pid !== null) job.pid = r.pid
    if (r.session_id !== null) job.sessionId = r.session_id
    if (r.last_heartbeat !== null) job.lastHeartbeat = r.last_heartbeat
    return job
  })
}
