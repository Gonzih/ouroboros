import { getDb, enqueue, log } from '@ouroboros/core'
import { randomUUID } from 'node:crypto'

export type ToolResult = { content: Array<{ type: 'text'; text: string }> }

export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] }
}

export const jobTools = [
  {
    name: 'list_jobs',
    description: 'List Ouroboros jobs, optionally filtered by status',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'running', 'completed', 'failed', 'cancelled', 'cancellation_requested'],
          description: 'Filter by status (omit for all)',
        },
        limit: { type: 'number', description: 'Max rows to return (default 20)' },
        offset: { type: 'number', description: 'Number of rows to skip for pagination (default 0)' },
      },
    },
  },
  {
    name: 'get_job_output',
    description: 'Get the output lines for a job (tail N most recent lines)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        job_id: { type: 'string', description: 'Job ID' },
        tail: { type: 'number', description: 'Number of most recent lines to return (default 50)' },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'get_job_status',
    description: 'Get the current status, timing, and error for a specific job',
    inputSchema: {
      type: 'object' as const,
      properties: {
        job_id: { type: 'string', description: 'Job ID' },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'spawn_worker',
    description: 'Create and enqueue a new worker job',
    inputSchema: {
      type: 'object' as const,
      properties: {
        description: { type: 'string', description: 'Human-readable description of the task' },
        backend: {
          type: 'string',
          enum: ['git', 'local', 's3', 'gdrive', 'onedrive'],
          description: 'Storage backend for the worker',
        },
        target: { type: 'string', description: 'Target path or repository URL' },
        instructions: {
          type: 'string',
          description: 'Detailed worker instructions (defaults to description if omitted)',
        },
      },
      required: ['description', 'backend', 'target'],
    },
  },
  {
    name: 'cancel_job',
    description: 'Cancel a pending or running job',
    inputSchema: {
      type: 'object' as const,
      properties: {
        job_id: { type: 'string', description: 'Job ID to cancel' },
      },
      required: ['job_id'],
    },
  },
]

export async function handleJobTool(
  name: string,
  args: Record<string, unknown> | undefined,
): Promise<ToolResult> {
  const a = args ?? {}
  const db = getDb()

  if (name === 'list_jobs') {
    const status = typeof a['status'] === 'string' ? a['status'] : null
    const limit = typeof a['limit'] === 'number' ? a['limit'] : 20
    const offset = typeof a['offset'] === 'number' ? a['offset'] : 0
    const rows = await db`
      SELECT * FROM ouro_jobs
      WHERE (${status}::text IS NULL OR status = ${status})
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `
    return textResult(JSON.stringify(rows, null, 2))
  }

  if (name === 'get_job_output') {
    const jobId = typeof a['job_id'] === 'string' ? a['job_id'] : ''
    const tail = typeof a['tail'] === 'number' ? a['tail'] : 50
    const rows = await db<{ line: string }[]>`
      SELECT line FROM ouro_job_output WHERE job_id = ${jobId} ORDER BY ts DESC LIMIT ${tail}
    `
    const lines = rows.map(r => r.line).reverse()
    return textResult(lines.join('\n'))
  }

  if (name === 'get_job_status') {
    const jobId = typeof a['job_id'] === 'string' ? a['job_id'] : ''
    const rows = await db<{
      status: string
      started_at: Date | null
      completed_at: Date | null
      error: string | null
      instructions: string | null
    }[]>`
      SELECT status, started_at, completed_at, error, instructions FROM ouro_jobs WHERE id = ${jobId}
    `
    const row = rows[0]
    if (!row) return textResult(JSON.stringify({ error: 'job not found' }))
    return textResult(JSON.stringify(row, null, 2))
  }

  if (name === 'spawn_worker') {
    const description = typeof a['description'] === 'string' ? a['description'] : ''
    const backend = typeof a['backend'] === 'string' ? a['backend'] : 'local'
    const target = typeof a['target'] === 'string' ? a['target'] : ''
    const instructions = typeof a['instructions'] === 'string' ? a['instructions'] : description
    const id = randomUUID()

    await db`
      INSERT INTO ouro_jobs (id, description, backend, target, status, instructions)
      VALUES (${id}, ${description}, ${backend}, ${target}, 'pending', ${instructions})
    `
    await enqueue('ouro_tasks', { id, backend, target, instructions })
    await log('mcp-server', `spawned worker job ${id}: ${description}`)
    return textResult(JSON.stringify({ job_id: id }))
  }

  if (name === 'cancel_job') {
    const jobId = typeof a['job_id'] === 'string' ? a['job_id'] : ''
    // Pending jobs can be cancelled immediately; running jobs get cancellation_requested
    // so the worker-dispatch watchdog can send SIGTERM and clean up properly.
    const pendingRows = await db<{ id: string }[]>`
      UPDATE ouro_jobs SET status = 'cancelled', completed_at = NOW()
      WHERE id = ${jobId} AND status = 'pending'
      RETURNING id
    `
    if (pendingRows.length > 0) return textResult(JSON.stringify({ cancelled: true }))

    const runningRows = await db<{ id: string }[]>`
      UPDATE ouro_jobs SET status = 'cancellation_requested'
      WHERE id = ${jobId} AND status = 'running'
      RETURNING id
    `
    return textResult(JSON.stringify({ cancelled: runningRows.length > 0 }))
  }

  throw new Error(`Unknown job tool: ${name}`)
}
