import { spawnSync } from 'node:child_process'
import { getDb, enqueue, publish } from '@ouroboros/core'
import { randomUUID } from 'node:crypto'
import { textResult } from './jobs.js'
import type { ToolResult } from './jobs.js'

export const feedbackTools = [
  {
    name: 'submit_feedback',
    description: 'Submit feedback or a self-evolution request',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'Feedback text or evolution request' },
        source: {
          type: 'string',
          enum: ['ui', 'telegram', 'slack', 'webhook'],
          description: 'Source of the feedback (default: ui)',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'list_feedback',
    description: 'List feedback events, optionally filtered by status',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'pr_open', 'approved', 'merge_ready', 'rejected', 'applied'],
          description: 'Filter by status (omit for all)',
        },
        limit: { type: 'number', description: 'Max rows to return (default 20)' },
      },
    },
  },
  {
    name: 'approve_evolution',
    description: 'Approve a pending evolution PR — sets status to approved, awaiting human merge via merge_evolution()',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Feedback ID with status pr_open' },
      },
      required: ['id'],
    },
  },
  {
    name: 'reject_evolution',
    description: 'Reject a pending evolution PR',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Feedback ID to reject' },
        reason: { type: 'string', description: 'Optional rejection reason' },
      },
      required: ['id'],
    },
  },
  {
    name: 'merge_evolution',
    description: 'Merge an approved evolution PR (human-initiated action only — runs gh pr merge --squash)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Feedback ID with status merge_ready or approved' },
      },
      required: ['id'],
    },
  },
]

export async function handleFeedbackTool(
  name: string,
  args: Record<string, unknown> | undefined,
): Promise<ToolResult> {
  const a = args ?? {}
  const db = getDb()

  if (name === 'submit_feedback') {
    const text = typeof a['text'] === 'string' ? a['text'] : ''
    const source = typeof a['source'] === 'string' ? a['source'] : 'ui'
    const id = randomUUID()

    await db`
      INSERT INTO ouro_feedback (id, source, text, status)
      VALUES (${id}, ${source}, ${text}, 'pending')
    `
    await enqueue('ouro_feedback', { id, source, text })
    return textResult(JSON.stringify({ id }))
  }

  if (name === 'list_feedback') {
    const status = typeof a['status'] === 'string' ? a['status'] : null
    const limit = typeof a['limit'] === 'number' ? a['limit'] : 20
    const rows = await db`
      SELECT * FROM ouro_feedback
      WHERE (${status}::text IS NULL OR status = ${status})
      ORDER BY created_at DESC
      LIMIT ${limit}
    `
    return textResult(JSON.stringify(rows, null, 2))
  }

  if (name === 'approve_evolution') {
    const id = typeof a['id'] === 'string' ? a['id'] : ''
    const rows = await db<{ id: string }[]>`
      UPDATE ouro_feedback SET status = 'approved'
      WHERE id = ${id} AND status = 'pr_open'
      RETURNING id
    `
    const approved = rows.length > 0
    if (approved) {
      await publish('ouro_notify', { type: 'evolution_approved', feedbackId: id })
    }
    return textResult(JSON.stringify({ approved }))
  }

  if (name === 'reject_evolution') {
    const id = typeof a['id'] === 'string' ? a['id'] : ''
    const reason = typeof a['reason'] === 'string' ? a['reason'] : null
    const rows = await db<{ id: string }[]>`
      UPDATE ouro_feedback SET status = 'rejected', rejection_reason = ${reason}
      WHERE id = ${id}
      RETURNING id
    `
    return textResult(JSON.stringify({ rejected: rows.length > 0 }))
  }

  if (name === 'merge_evolution') {
    const id = typeof a['id'] === 'string' ? a['id'] : ''
    const rows = await db<{ pr_url: string; status: string }[]>`
      SELECT pr_url, status FROM ouro_feedback WHERE id = ${id}
    `
    const row = rows[0]
    if (!row) return textResult(JSON.stringify({ error: 'feedback not found' }))
    if (row.status !== 'merge_ready' && row.status !== 'approved') {
      return textResult(JSON.stringify({ error: `cannot merge: status is ${row.status}` }))
    }
    const prUrl = row.pr_url
    if (!prUrl) return textResult(JSON.stringify({ error: 'no PR URL on record' }))

    const result = spawnSync('gh', ['pr', 'merge', '--squash', prUrl], {
      encoding: 'utf8',
      timeout: 60_000,
    })

    if (result.status === 0) {
      await db`
        UPDATE ouro_feedback SET status = 'applied', resolved_at = NOW()
        WHERE id = ${id}
      `
      await publish('ouro_notify', { type: 'evolution_applied', feedbackId: id, prUrl })
      return textResult(JSON.stringify({ merged: true, prUrl }))
    }

    const stderr = result.stderr ?? ''
    return textResult(JSON.stringify({ merged: false, error: stderr }))
  }

  throw new Error(`Unknown feedback tool: ${name}`)
}
