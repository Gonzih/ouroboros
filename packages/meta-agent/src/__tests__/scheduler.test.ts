import { describe, it, expect, vi, beforeEach } from 'vitest'

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

import { tickScheduler } from '../loops/scheduler.js'
import { enqueue, publish } from '@ouroboros/core'

const mockEnqueue = vi.mocked(enqueue)
const mockPublish = vi.mocked(publish)

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
