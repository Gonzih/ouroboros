import { getDb } from '@ouroboros/core'
import { textResult } from './jobs.js'
import type { ToolResult } from './jobs.js'

export const logTools = [
  {
    name: 'get_logs',
    description: 'Fetch recent log lines, optionally filtered by source and time',
    inputSchema: {
      type: 'object' as const,
      properties: {
        source: { type: 'string', description: 'Filter by log source (e.g. meta-agent, worker)' },
        limit: { type: 'number', description: 'Max lines to return (default 100)' },
        since: {
          type: 'string',
          description: 'ISO 8601 timestamp — only return logs after this time',
        },
      },
    },
  },
]

export async function handleLogTool(
  name: string,
  args: Record<string, unknown> | undefined,
): Promise<ToolResult> {
  const a = args ?? {}
  const db = getDb()

  if (name === 'get_logs') {
    const source = typeof a['source'] === 'string' ? a['source'] : null
    const limit = typeof a['limit'] === 'number' ? a['limit'] : 100
    const since = typeof a['since'] === 'string' ? a['since'] : null

    const rows = await db<{ source: string; message: string; ts: Date }[]>`
      SELECT source, message, ts FROM ouro_logs
      WHERE (${source}::text IS NULL OR source = ${source})
        AND (${since}::timestamptz IS NULL OR ts > ${since}::timestamptz)
      ORDER BY ts DESC
      LIMIT ${limit}
    `
    const lines = rows
      .reverse()
      .map(r => `[${r.source}] ${r.message}`)
    return textResult(lines.join('\n'))
  }

  throw new Error(`Unknown log tool: ${name}`)
}
