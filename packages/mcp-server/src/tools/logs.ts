import { getDb } from '@ouroboros/core'
import { textResult } from './jobs.js'
import type { ToolResult } from './jobs.js'

export const logTools = [
  {
    name: 'get_logs',
    description: 'Fetch recent log lines with system health summary, optionally filtered by source and time',
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

    const [healthRows, logRows] = await Promise.all([
      db<{
        running: number
        stalled: number
        failed_1h: number
        pending: number
        avg_min: number | null
      }[]>`
        SELECT
          COUNT(*) FILTER (WHERE status = 'running')::int                                                              AS running,
          COUNT(*) FILTER (WHERE status = 'running' AND last_heartbeat < NOW() - INTERVAL '30 minutes')::int          AS stalled,
          COUNT(*) FILTER (WHERE status = 'failed' AND completed_at > NOW() - INTERVAL '1 hour')::int                 AS failed_1h,
          COUNT(*) FILTER (WHERE status = 'pending')::int                                                              AS pending,
          (SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60)::numeric(10,2)
           FROM (
             SELECT completed_at, started_at FROM ouro_jobs
             WHERE status = 'completed' AND completed_at IS NOT NULL AND started_at IS NOT NULL
             ORDER BY completed_at DESC LIMIT 10
           ) sub)                                                                                                       AS avg_min
        FROM ouro_jobs
      `,
      db<{ source: string; message: string; ts: Date }[]>`
        SELECT source, message, ts FROM ouro_logs
        WHERE (${source}::text IS NULL OR source = ${source})
          AND (${since}::timestamptz IS NULL OR ts > ${since}::timestamptz)
        ORDER BY ts DESC
        LIMIT ${limit}
      `,
    ])

    const h = healthRows[0]
    const errorMessages = logRows
      .filter(r => /error|failed/i.test(r.message))
      .map(r => r.message)
    const topErrors = [...new Set(errorMessages)].slice(0, 5)

    const health = {
      runningJobs: h?.running ?? 0,
      stalledJobs: h?.stalled ?? 0,
      failedLast1h: h?.failed_1h ?? 0,
      pendingJobs: h?.pending ?? 0,
      avgJobDurationMin: h?.avg_min != null ? Number(h.avg_min) : 0,
      topErrors,
    }

    const logs = logRows
      .reverse()
      .map(r => `[${r.source}] ${r.message}`)

    return textResult(JSON.stringify({ health, logs }, null, 2))
  }

  throw new Error(`Unknown log tool: ${name}`)
}
