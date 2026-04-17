import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockDb = vi.fn()

vi.mock('@ouroboros/core', () => ({
  getDb: () => mockDb,
  enqueue: vi.fn().mockResolvedValue(1n),
  log: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('croner', () => ({
  Cron: vi.fn().mockImplementation(() => ({
    nextRun: vi.fn().mockReturnValue(new Date('2026-04-17T09:00:00Z')),
  })),
}))

import { tickScheduler, startScheduler } from '../loops/scheduler.js'
import { enqueue, publish, log } from '@ouroboros/core'
import { Cron } from 'croner'

const mockEnqueue = vi.mocked(enqueue)
const mockPublish = vi.mocked(publish)
const mockLog = vi.mocked(log)
const mockCron = vi.mocked(Cron)

async function flush(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

describe('tickScheduler', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('dispatches a job and updates next_run_at when a schedule is due', async () => {
    const schedule = {
      id: 'sched-1',
      name: 'daily-summary',
      cron_expr: '0 9 * * *',
      backend: 'git',
      target: 'https://github.com/owner/repo',
      instructions: 'Summarize today',
    }

    // First call: SELECT due schedules — returns one
    // Second call: INSERT into ouro_jobs
    // Third call: enqueue (handled by mock)
    // Fourth call: UPDATE ouro_schedules
    mockDb
      .mockResolvedValueOnce([schedule])  // SELECT due
      .mockResolvedValueOnce([])          // INSERT job
      .mockResolvedValueOnce([])          // UPDATE schedule

    await tickScheduler()

    // Verify the DB INSERT writes the instructions column (regression: was missing before fix)
    const insertCall = mockDb.mock.calls[1] as unknown[]
    const insertSql = (insertCall[0] as readonly string[]).join('')
    expect(insertSql).toMatch(/\binstructions\b/)
    expect(insertCall[insertCall.length - 1]).toBe('Summarize today')

    expect(mockEnqueue).toHaveBeenCalledWith('ouro_tasks', expect.objectContaining({
      backend: 'git',
      target: 'https://github.com/owner/repo',
      instructions: 'Summarize today',
    }))
    expect(mockPublish).toHaveBeenCalledWith('ouro_notify', expect.objectContaining({
      type: 'schedule_triggered',
      scheduleId: 'sched-1',
    }))
  })

  it('does nothing when no schedules are due', async () => {
    mockDb.mockResolvedValueOnce([])  // SELECT returns empty

    await tickScheduler()

    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('uses null for next_run_at when Cron constructor throws', async () => {
    mockCron.mockImplementationOnce(() => { throw new Error('invalid cron expression') })

    const schedule = {
      id: 'sched-bad',
      name: 'bad-cron',
      cron_expr: 'not-valid',
      backend: 'local',
      target: '/tmp',
      instructions: 'run',
    }
    mockDb
      .mockResolvedValueOnce([schedule])  // SELECT due
      .mockResolvedValueOnce([])          // INSERT job
      .mockResolvedValueOnce([])          // UPDATE schedule (next_run_at = null)

    await tickScheduler()

    // Job was still dispatched despite bad cron expression
    expect(mockEnqueue).toHaveBeenCalledOnce()
    expect(mockPublish).toHaveBeenCalledWith('ouro_notify', expect.objectContaining({ scheduleId: 'sched-bad' }))
  })

  it('dispatches one job per due schedule', async () => {
    const schedules = [
      { id: 's1', name: 'job-a', cron_expr: '0 9 * * *', backend: 'git', target: 'repo-a', instructions: 'Do A' },
      { id: 's2', name: 'job-b', cron_expr: '0 10 * * *', backend: 'local', target: '/tmp/b', instructions: 'Do B' },
    ]

    mockDb
      .mockResolvedValueOnce(schedules)  // SELECT due
      .mockResolvedValueOnce([])         // INSERT job for s1
      .mockResolvedValueOnce([])         // UPDATE schedule for s1
      .mockResolvedValueOnce([])         // INSERT job for s2
      .mockResolvedValueOnce([])         // UPDATE schedule for s2

    await tickScheduler()

    expect(mockEnqueue).toHaveBeenCalledTimes(2)
    expect(mockPublish).toHaveBeenCalledTimes(2)
    expect(mockPublish).toHaveBeenCalledWith('ouro_notify', expect.objectContaining({ scheduleId: 's1' }))
    expect(mockPublish).toHaveBeenCalledWith('ouro_notify', expect.objectContaining({ scheduleId: 's2' }))
  })
})

describe('startScheduler / initNextRunAt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initialises next_run_at for schedules that have none on startup', async () => {
    mockDb
      .mockResolvedValueOnce([{ id: 'sched-a', cron_expr: '0 9 * * *' }])  // initNextRunAt SELECT
      .mockResolvedValueOnce([])                                              // initNextRunAt UPDATE
      .mockResolvedValueOnce([])                                              // first tickScheduler SELECT (nothing due)

    void startScheduler()
    await flush()

    // initNextRunAt fired: SELECT + UPDATE = 2 db calls; tickScheduler SELECT = 1 more
    expect(mockDb).toHaveBeenCalledTimes(3)
    // No jobs dispatched — nothing was due
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('skips UPDATE when there are no null-next_run_at schedules', async () => {
    mockDb
      .mockResolvedValueOnce([])  // initNextRunAt SELECT returns empty
      .mockResolvedValueOnce([])  // tickScheduler SELECT (nothing due)

    void startScheduler()
    await flush()

    expect(mockDb).toHaveBeenCalledTimes(2)
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('logs tick errors via the startScheduler catch handler', async () => {
    mockDb
      .mockResolvedValueOnce([])                              // initNextRunAt SELECT returns empty
      .mockRejectedValueOnce(new Error('tick db crash'))      // tickScheduler SELECT throws

    void startScheduler()
    await flush()

    expect(mockLog).toHaveBeenCalledWith(
      'meta-agent:scheduler',
      expect.stringContaining('tick error'),
    )
  })
})
