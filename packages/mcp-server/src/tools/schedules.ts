import { getDb, log } from '@ouroboros/core'
import { randomUUID } from 'node:crypto'
import { Cron } from 'croner'
import type { ToolResult } from './jobs.js'
import { textResult } from './jobs.js'

export const scheduleTools = [
  {
    name: 'list_schedules',
    description: 'List all scheduled job templates',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'create_schedule',
    description: 'Create a recurring job schedule',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Unique name for this schedule' },
        cron_expr: { type: 'string', description: 'Cron expression (e.g. "0 9 * * *" for 9am daily)' },
        backend: {
          type: 'string',
          enum: ['git', 'local', 's3', 'gdrive', 'onedrive'],
          description: 'Storage backend for spawned workers',
        },
        target: { type: 'string', description: 'Target path or repository URL' },
        instructions: { type: 'string', description: 'Instructions passed to each spawned worker' },
      },
      required: ['name', 'cron_expr', 'backend', 'target', 'instructions'],
    },
  },
  {
    name: 'update_schedule',
    description: 'Update fields of an existing schedule. Only provided fields are changed; omitted fields keep their current values. Changing cron_expr recomputes next_run_at.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Schedule ID to update' },
        name: { type: 'string', description: 'New unique name' },
        cron_expr: { type: 'string', description: 'New cron expression' },
        backend: {
          type: 'string',
          enum: ['git', 'local', 's3', 'gdrive', 'onedrive'],
          description: 'New storage backend',
        },
        target: { type: 'string', description: 'New target path or repository URL' },
        instructions: { type: 'string', description: 'New instructions for spawned workers' },
      },
      required: ['id'],
    },
  },
  {
    name: 'toggle_schedule',
    description: 'Enable or disable a schedule by ID',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Schedule ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_schedule',
    description: 'Delete a schedule by ID',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Schedule ID' },
      },
      required: ['id'],
    },
  },
]

export async function handleScheduleTool(
  name: string,
  args: Record<string, unknown> | undefined,
): Promise<ToolResult> {
  const a = args ?? {}
  const db = getDb()

  if (name === 'list_schedules') {
    const rows = await db`
      SELECT id, name, cron_expr, backend, target, instructions,
             enabled, last_run_at, next_run_at, created_at
      FROM ouro_schedules
      ORDER BY created_at DESC
    `
    return textResult(JSON.stringify(rows, null, 2))
  }

  if (name === 'create_schedule') {
    const scheduleName = typeof a['name'] === 'string' ? a['name'] : ''
    const cronExpr = typeof a['cron_expr'] === 'string' ? a['cron_expr'] : ''
    const backend = typeof a['backend'] === 'string' ? a['backend'] : 'local'
    const target = typeof a['target'] === 'string' ? a['target'] : ''
    const instructions = typeof a['instructions'] === 'string' ? a['instructions'] : ''

    let nextRun: Date | null = null
    try {
      const cron = new Cron(cronExpr)
      nextRun = cron.nextRun() ?? null
    } catch {
      return textResult(JSON.stringify({ error: 'invalid cron expression' }))
    }

    const id = randomUUID()
    await db`
      INSERT INTO ouro_schedules (id, name, cron_expr, backend, target, instructions, next_run_at)
      VALUES (${id}, ${scheduleName}, ${cronExpr}, ${backend}, ${target}, ${instructions}, ${nextRun})
    `
    await log('mcp-server', `created schedule "${scheduleName}" (${cronExpr})`)
    return textResult(JSON.stringify({ id }))
  }

  if (name === 'update_schedule') {
    const id = typeof a['id'] === 'string' ? a['id'] : ''
    const newName = typeof a['name'] === 'string' ? a['name'] : null
    const cronExpr = typeof a['cron_expr'] === 'string' ? a['cron_expr'] : null
    const backend = typeof a['backend'] === 'string' ? a['backend'] : null
    const target = typeof a['target'] === 'string' ? a['target'] : null
    const instructions = typeof a['instructions'] === 'string' ? a['instructions'] : null

    let nextRun: Date | null | undefined = undefined
    if (cronExpr !== null) {
      try {
        const cron = new Cron(cronExpr)
        nextRun = cron.nextRun() ?? null
      } catch {
        return textResult(JSON.stringify({ error: 'invalid cron expression' }))
      }
    }

    const rows = await db<{ id: string }[]>`
      UPDATE ouro_schedules
      SET
        name         = COALESCE(${newName}::text, name),
        cron_expr    = COALESCE(${cronExpr}::text, cron_expr),
        backend      = COALESCE(${backend}::text, backend),
        target       = COALESCE(${target}::text, target),
        instructions = COALESCE(${instructions}::text, instructions),
        next_run_at  = CASE WHEN ${nextRun !== undefined} THEN ${nextRun ?? null} ELSE next_run_at END
      WHERE id = ${id}
      RETURNING id
    `
    if (rows.length === 0) return textResult(JSON.stringify({ error: 'schedule not found' }))
    await log('mcp-server', `updated schedule ${id}`)
    return textResult(JSON.stringify({ updated: true }))
  }

  if (name === 'toggle_schedule') {
    const id = typeof a['id'] === 'string' ? a['id'] : ''
    const rows = await db<{ id: string; enabled: boolean }[]>`
      UPDATE ouro_schedules
      SET enabled = NOT enabled
      WHERE id = ${id}
      RETURNING id, enabled
    `
    if (rows.length === 0) return textResult(JSON.stringify({ error: 'schedule not found' }))
    return textResult(JSON.stringify({ id, enabled: rows[0]?.enabled }))
  }

  if (name === 'delete_schedule') {
    const id = typeof a['id'] === 'string' ? a['id'] : ''
    const rows = await db<{ id: string }[]>`
      DELETE FROM ouro_schedules WHERE id = ${id} RETURNING id
    `
    if (rows.length === 0) return textResult(JSON.stringify({ error: 'schedule not found' }))
    await log('mcp-server', `deleted schedule ${id}`)
    return textResult(JSON.stringify({ deleted: true }))
  }

  throw new Error(`Unknown schedule tool: ${name}`)
}
