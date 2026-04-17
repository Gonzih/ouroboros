import { randomUUID } from 'node:crypto'
import { Cron } from 'croner'
import { getDb, enqueue, log, publish } from '@ouroboros/core'

interface ScheduleRow {
  id: string
  name: string
  cron_expr: string
  backend: string
  target: string
  instructions: string
}

function nextRunAfter(cronExpr: string, after: Date): Date | null {
  try {
    const cron = new Cron(cronExpr, { startAt: after })
    return cron.nextRun() ?? null
  } catch {
    return null
  }
}

export async function tickScheduler(): Promise<void> {
  const db = getDb()
  const due = await db<ScheduleRow[]>`
    SELECT id, name, cron_expr, backend, target, instructions
    FROM ouro_schedules
    WHERE enabled = TRUE
      AND (next_run_at IS NULL OR next_run_at <= NOW())
  `

  for (const schedule of due) {
    const jobId = randomUUID()
    await db`
      INSERT INTO ouro_jobs (id, description, backend, target, status, instructions)
      VALUES (${jobId}, ${schedule.instructions}, ${schedule.backend}, ${schedule.target}, 'pending', ${schedule.instructions})
    `
    await enqueue('ouro_tasks', {
      id: jobId,
      backend: schedule.backend,
      target: schedule.target,
      instructions: schedule.instructions,
    })

    const nextRun = nextRunAfter(schedule.cron_expr, new Date())
    await db`
      UPDATE ouro_schedules
      SET last_run_at = NOW(), next_run_at = ${nextRun}
      WHERE id = ${schedule.id}
    `

    await log(
      'meta-agent:scheduler',
      `triggered job ${jobId} for schedule "${schedule.name}", next: ${nextRun?.toISOString() ?? 'none'}`,
    )
    await publish('ouro_notify', { type: 'schedule_triggered', scheduleId: schedule.id, jobId })
  }
}

async function initNextRunAt(): Promise<void> {
  const db = getDb()
  // On startup, compute next_run_at for any schedule that has null (new or reset)
  const rows = await db<{ id: string; cron_expr: string }[]>`
    SELECT id, cron_expr FROM ouro_schedules
    WHERE enabled = TRUE AND next_run_at IS NULL
  `
  for (const row of rows) {
    const nextRun = nextRunAfter(row.cron_expr, new Date())
    await db`UPDATE ouro_schedules SET next_run_at = ${nextRun} WHERE id = ${row.id}`
  }
}

export async function startScheduler(): Promise<void> {
  await initNextRunAt()

  const intervalMs = parseInt(process.env['OURO_SCHEDULER_INTERVAL_MS'] ?? '30000', 10)

  const run = (): void => {
    void tickScheduler()
      .catch((err: unknown) => {
        void log('meta-agent:scheduler', `tick error: ${String(err)}`)
      })
      .finally(() => {
        setTimeout(run, intervalMs)
      })
  }

  run()
  await new Promise<never>(() => undefined)
}
