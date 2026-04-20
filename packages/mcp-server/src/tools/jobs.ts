import { getDb, enqueue, log } from '@ouroboros/core'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'

export type ToolResult = { content: Array<{ type: 'text'; text: string }> }

export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] }
}

// Returns a warning string if the task looks compound, undefined otherwise.
export function checkAtomicity(task: string): string | undefined {
  const sentences = task.split(/\.\s+/).filter(s => s.trim().length > 0)
  const compoundMatches = (task.match(/\band also\b|\badditionally\b|\bfurthermore\b|\bplus\b/gi) ?? []).length
  const numberedItems = (task.match(/^\s*\d+[.)]/gm) ?? []).length

  if (sentences.length > 5 || compoundMatches > 2 || numberedItems > 3) {
    return 'Task may be compound — consider splitting with split_task'
  }
  return undefined
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
    description: 'Get the current status, timing, error, and atomicity warning for a specific job',
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
  {
    name: 'retry_job',
    description: 'Retry a failed or cancelled job by creating a new job with the same parameters',
    inputSchema: {
      type: 'object' as const,
      properties: {
        job_id: { type: 'string', description: 'ID of the failed or cancelled job to retry' },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'split_task',
    description: 'Break a large or compound task into atomic, independently-executable subtasks',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task: { type: 'string', description: 'The task description to split' },
        repo_url: { type: 'string', description: 'Repository URL for context' },
      },
      required: ['task', 'repo_url'],
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
      atomicity_warning: string | null
    }[]>`
      SELECT status, started_at, completed_at, error, instructions, atomicity_warning FROM ouro_jobs WHERE id = ${jobId}
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
    const atomicityWarning = checkAtomicity(instructions) ?? null

    await db`
      INSERT INTO ouro_jobs (id, description, backend, target, status, instructions, atomicity_warning)
      VALUES (${id}, ${description}, ${backend}, ${target}, 'pending', ${instructions}, ${atomicityWarning})
    `
    await enqueue('ouro_tasks', { id, backend, target, instructions })
    await log('mcp-server', `spawned worker job ${id}: ${description}`)
    return textResult(JSON.stringify({ job_id: id, atomicityWarning }))
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

  if (name === 'retry_job') {
    const jobId = typeof a['job_id'] === 'string' ? a['job_id'] : ''
    const rows = await db<{ description: string; backend: string; target: string; status: string; instructions: string | null }[]>`
      SELECT description, backend, target, status, instructions FROM ouro_jobs WHERE id = ${jobId}
    `
    const job = rows[0]
    if (!job) return textResult(JSON.stringify({ error: 'job not found' }))
    if (job.status !== 'failed' && job.status !== 'cancelled') {
      return textResult(JSON.stringify({ error: 'can only retry failed or cancelled jobs', status: job.status }))
    }
    const newId = randomUUID()
    const instructions = job.instructions ?? job.description
    await db`
      INSERT INTO ouro_jobs (id, description, backend, target, status, instructions)
      VALUES (${newId}, ${job.description}, ${job.backend}, ${job.target}, 'pending', ${instructions})
    `
    await enqueue('ouro_tasks', { id: newId, backend: job.backend, target: job.target, instructions })
    await log('mcp-server', `retrying job ${jobId} as new job ${newId}`)
    return textResult(JSON.stringify({ job_id: newId }))
  }

  if (name === 'split_task') {
    const task = typeof a['task'] === 'string' ? a['task'] : ''
    const repoUrl = typeof a['repo_url'] === 'string' ? a['repo_url'] : ''
    const claudeBin = process.env['CLAUDE_BIN'] ?? 'claude'

    const prompt = [
      'Break this task into atomic, independently-executable subtasks. Each subtask should:',
      '- Do exactly one thing',
      '- Be completable in a single agent session',
      '- Have a clear success criterion',
      '- Not depend on implementation details of other subtasks',
      '',
      `Task: ${task}`,
      `Repo: ${repoUrl}`,
      '',
      'Return ONLY valid JSON in this exact shape (no markdown, no explanation):',
      '{"subtasks": [{"title": "...", "description": "...", "estimated_complexity": "small"}]}',
      'estimated_complexity must be one of: trivial, small, medium',
    ].join('\n')

    const result = spawnSync(claudeBin, ['--print', '-p', prompt], {
      timeout: 30_000,
      encoding: 'utf-8',
      env: { ...process.env },
    })

    if (result.error !== undefined) {
      return textResult(JSON.stringify({ error: `split_task failed: ${result.error.message}` }))
    }
    if (result.status !== 0) {
      return textResult(JSON.stringify({ error: `split_task exited with code ${result.status ?? 'unknown'}` }))
    }

    const stdout = (result.stdout ?? '').trim()
    // Try direct JSON parse first, then extract from surrounding text
    const attempts = [stdout, (stdout.match(/\{[\s\S]*\}/) ?? [])[0] ?? '']
    for (const attempt of attempts) {
      if (!attempt) continue
      try {
        const parsed = JSON.parse(attempt) as { subtasks: unknown[] }
        return textResult(JSON.stringify(parsed))
      } catch {
        // try next
      }
    }
    return textResult(JSON.stringify({ error: 'failed to parse split_task output', raw: stdout.slice(0, 300) }))
  }

  throw new Error(`Unknown job tool: ${name}`)
}
