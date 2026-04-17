import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@ouroboros/core', () => ({
  getDb: vi.fn(),
  log: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(undefined),
  enqueue: vi.fn().mockResolvedValue(BigInt(1)),
  unregisterProcess: vi.fn().mockResolvedValue(undefined),
  registerProcess: vi.fn().mockResolvedValue(undefined),
  getStaleJobs: vi.fn().mockResolvedValue([]),
}))

vi.mock('node:child_process', () => ({
  spawn: vi.fn().mockReturnValue({ pid: 42, on: vi.fn(), stdout: null, stderr: null }),
}))

import { spawn } from 'node:child_process'
import { getDb, log, publish, enqueue, unregisterProcess, getStaleJobs, registerProcess } from '@ouroboros/core'
import { watchdogTick, makeMetaAgentState, watchdogLoop } from '../loops/watchdog.js'
import type { MetaAgentState } from '../loops/watchdog.js'

const mockSpawn = vi.mocked(spawn)
const mockGetDb = vi.mocked(getDb)
const mockLog = vi.mocked(log)
const mockPublish = vi.mocked(publish)
const mockEnqueue = vi.mocked(enqueue)
const mockUnregisterProcess = vi.mocked(unregisterProcess)
const mockRegisterProcess = vi.mocked(registerProcess)
const mockGetStaleJobs = vi.mocked(getStaleJobs)

describe('watchdogTick', () => {
  beforeEach(() => { vi.clearAllMocks() })

  const noOpState: MetaAgentState = { restartService: vi.fn() }

  describe('stale job handling', () => {
    it('does nothing when no stale jobs exist', async () => {
      mockGetStaleJobs.mockResolvedValueOnce([])
      const mockDbFn = vi.fn().mockResolvedValue([])
      mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)

      await watchdogTick(noOpState)

      expect(mockEnqueue).not.toHaveBeenCalled()
      expect(mockPublish).not.toHaveBeenCalled()
    })

    it('resets and requeues a job whose PID is dead', async () => {
      const staleJob = {
        id: 'job-dead',
        description: 'some task',
        backend: 'local' as const,
        target: '/tmp/work',
        status: 'running' as const,
        createdAt: new Date(),
        pid: 999999999,
      }
      mockGetStaleJobs.mockResolvedValueOnce([staleJob])

      const mockDbFn = vi.fn().mockResolvedValue([])
      mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)

      await watchdogTick(noOpState)

      expect(mockLog).toHaveBeenCalledWith('watchdog', expect.stringContaining('job-dead'))
      expect(mockDbFn).toHaveBeenCalled()
      expect(mockEnqueue).toHaveBeenCalledWith('ouro_tasks', expect.objectContaining({
        id: 'job-dead',
        backend: 'local',
        target: '/tmp/work',
      }))
      expect(mockPublish).toHaveBeenCalledWith('ouro_notify', {
        type: 'job_requeued',
        jobId: 'job-dead',
        reason: 'watchdog_dead_pid',
      })
    })

    it('includes sessionId in requeue payload when present', async () => {
      const staleJob = {
        id: 'job-sess',
        description: 'task with session',
        backend: 'git' as const,
        target: 'https://github.com/owner/repo',
        status: 'running' as const,
        createdAt: new Date(),
        pid: 999999999,
        sessionId: 'sess-abc',
      }
      mockGetStaleJobs.mockResolvedValueOnce([staleJob])

      const mockDbFn = vi.fn().mockResolvedValue([])
      mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)

      await watchdogTick(noOpState)

      expect(mockEnqueue).toHaveBeenCalledWith('ouro_tasks', expect.objectContaining({
        id: 'job-sess',
        sessionId: 'sess-abc',
      }))
    })

    it('skips a stale job whose PID is still alive', async () => {
      const staleJob = {
        id: 'job-alive',
        description: 'still running',
        backend: 'local' as const,
        target: '/tmp',
        status: 'running' as const,
        createdAt: new Date(),
        pid: process.pid, // current process — definitely alive
      }
      mockGetStaleJobs.mockResolvedValueOnce([staleJob])
      const mockDbFn = vi.fn().mockResolvedValue([])
      mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)

      await watchdogTick(noOpState)

      // job is alive — should not reset or requeue
      expect(mockEnqueue).not.toHaveBeenCalled()
      expect(mockPublish).not.toHaveBeenCalled()
    })

    it('skips a stale job with no PID (undefined)', async () => {
      const staleJob = {
        id: 'job-nopid',
        description: 'no pid set',
        backend: 'local' as const,
        target: '/tmp',
        status: 'running' as const,
        createdAt: new Date(),
        pid: undefined,
        sessionId: undefined,
      }
      mockGetStaleJobs.mockResolvedValueOnce([staleJob as never])
      const mockDbFn = vi.fn().mockResolvedValue([])
      mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)

      await watchdogTick(noOpState)

      // pid undefined → alive=false → should reset/requeue
      expect(mockEnqueue).toHaveBeenCalledWith('ouro_tasks', expect.objectContaining({ id: 'job-nopid' }))
    })

    it('logs error and continues when getStaleJobs throws', async () => {
      mockGetStaleJobs.mockRejectedValueOnce(new Error('db gone'))
      const mockDbFn = vi.fn().mockResolvedValue([])
      mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)

      await watchdogTick(noOpState)

      expect(mockLog).toHaveBeenCalledWith('watchdog', expect.stringContaining('stale job check failed'))
    })

    it('treats EPERM from process.kill as alive — does not requeue', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementationOnce(() => {
        const err = Object.assign(new Error('Operation not permitted'), { code: 'EPERM' })
        throw err
      })

      const staleJob = {
        id: 'job-eperm',
        description: 'eperm test',
        backend: 'local' as const,
        target: '/tmp',
        status: 'running' as const,
        createdAt: new Date(),
        pid: 12345,
      }
      mockGetStaleJobs.mockResolvedValueOnce([staleJob])
      const mockDbFn = vi.fn().mockResolvedValue([])
      mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)

      await watchdogTick(noOpState)

      expect(mockEnqueue).not.toHaveBeenCalled()
      killSpy.mockRestore()
    })
  })

  describe('service restart', () => {
    it('restarts a service whose PID is dead', async () => {
      const state: MetaAgentState = { restartService: vi.fn() }
      // getStaleJobs is mocked separately; getDb is only called for the service SELECT
      const mockDbFn = vi.fn().mockResolvedValueOnce([
        { name: 'gateway', pid: 999999999, command: 'node', args: ['gateway/dist/index.js'] },
      ])
      mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)

      await watchdogTick(state)

      expect(mockLog).toHaveBeenCalledWith('watchdog', expect.stringContaining('gateway'))
      expect(mockUnregisterProcess).toHaveBeenCalledWith('gateway')
      expect(state.restartService).toHaveBeenCalledWith('gateway', 'node', ['gateway/dist/index.js'])
    })

    it('does not restart a service whose PID is alive', async () => {
      const state: MetaAgentState = { restartService: vi.fn() }
      const mockDbFn = vi.fn().mockResolvedValueOnce([
        { name: 'ui', pid: process.pid, command: 'node', args: ['ui/dist/index.js'] },
      ])
      mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)

      await watchdogTick(state)

      expect(state.restartService).not.toHaveBeenCalled()
      expect(mockUnregisterProcess).not.toHaveBeenCalled()
    })

    it('logs error and continues when service DB query throws', async () => {
      const mockDbFn = vi.fn().mockRejectedValueOnce(new Error('connection lost'))
      mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)

      await watchdogTick(noOpState)

      expect(mockLog).toHaveBeenCalledWith('watchdog', expect.stringContaining('service check failed'))
    })
  })
})

describe('pruneOldData (via watchdogTick)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  const noOpState: MetaAgentState = { restartService: vi.fn() }

  it('logs pruned row count when old logs are deleted', async () => {
    mockGetStaleJobs.mockResolvedValueOnce([])
    // First call: services query (returns empty)
    // Second call: log pruning CTE (returns count > 0)
    // Third call: job output pruning CTE (returns count 0)
    const mockDbFn = vi.fn()
      .mockResolvedValueOnce([])                       // services
      .mockResolvedValueOnce([{ count: '42' }])        // log prune
      .mockResolvedValueOnce([{ count: '0' }])         // output prune
    mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)

    await watchdogTick(noOpState)

    expect(mockLog).toHaveBeenCalledWith('watchdog', expect.stringContaining('42 log rows'))
  })

  it('logs pruned row count when old job output is deleted', async () => {
    mockGetStaleJobs.mockResolvedValueOnce([])
    const mockDbFn = vi.fn()
      .mockResolvedValueOnce([])                       // services
      .mockResolvedValueOnce([{ count: '0' }])         // log prune
      .mockResolvedValueOnce([{ count: '7' }])         // output prune
    mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)

    await watchdogTick(noOpState)

    expect(mockLog).toHaveBeenCalledWith('watchdog', expect.stringContaining('7 job output rows'))
  })

  it('logs error and continues when log pruning DB query throws', async () => {
    mockGetStaleJobs.mockResolvedValueOnce([])
    const mockDbFn = vi.fn()
      .mockResolvedValueOnce([])                       // services
      .mockRejectedValueOnce(new Error('lock timeout')) // log prune fails
      .mockResolvedValueOnce([{ count: '0' }])         // output prune still runs
    mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)

    await watchdogTick(noOpState)

    expect(mockLog).toHaveBeenCalledWith('watchdog', expect.stringContaining('log pruning failed'))
  })

  it('logs error and continues when job output pruning DB query throws', async () => {
    mockGetStaleJobs.mockResolvedValueOnce([])
    const mockDbFn = vi.fn()
      .mockResolvedValueOnce([])                       // services
      .mockResolvedValueOnce([{ count: '0' }])         // log prune succeeds
      .mockRejectedValueOnce(new Error('disk full'))   // output prune fails
    mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)

    await watchdogTick(noOpState)

    expect(mockLog).toHaveBeenCalledWith('watchdog', expect.stringContaining('job output pruning failed'))
  })

  it('does not log when nothing was pruned', async () => {
    mockGetStaleJobs.mockResolvedValueOnce([])
    const mockDbFn = vi.fn()
      .mockResolvedValueOnce([])                       // services
      .mockResolvedValueOnce([{ count: '0' }])         // log prune — nothing
      .mockResolvedValueOnce([{ count: '0' }])         // output prune — nothing
    mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)

    await watchdogTick(noOpState)

    const pruneLogs = vi.mocked(mockLog).mock.calls.filter(
      ([, msg]) => typeof msg === 'string' && msg.includes('pruned'),
    )
    expect(pruneLogs).toHaveLength(0)
  })
})

describe('makeMetaAgentState', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('restartService spawns process with correct args', () => {
    const state = makeMetaAgentState()
    state.restartService('ui', 'node', ['dist/index.js'])
    expect(mockSpawn).toHaveBeenCalledWith('node', ['dist/index.js'], { detached: false })
  })

  it('restartService registers the new PID', async () => {
    mockSpawn.mockReturnValueOnce({ pid: 99, on: vi.fn(), stdout: null, stderr: null } as unknown as ReturnType<typeof spawn>)
    const state = makeMetaAgentState()
    state.restartService('gateway', 'node', ['gateway/dist/index.js'])
    // registerProcess is called async — let microtasks drain
    await Promise.resolve()
    await Promise.resolve()
    expect(mockRegisterProcess).toHaveBeenCalledWith('gateway', 99, 'node', ['gateway/dist/index.js'])
  })

  it('returns an object with restartService method', () => {
    const state = makeMetaAgentState()
    expect(typeof state.restartService).toBe('function')
  })
})

describe('watchdogLoop', () => {
  it('calls watchdogTick after the sleep interval elapses', async () => {
    vi.useFakeTimers()
    mockGetStaleJobs.mockResolvedValue([])
    const mockDbFn = vi.fn().mockResolvedValue([])
    mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)
    const state: MetaAgentState = { restartService: vi.fn() }

    void watchdogLoop(state)

    // Before any timer fires: watchdogTick has not run yet
    expect(mockGetStaleJobs).not.toHaveBeenCalled()

    // Advance past the default 60 s interval (WATCHDOG_INTERVAL_MS = 60000)
    await vi.advanceTimersByTimeAsync(60_001)

    expect(mockGetStaleJobs).toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('isPidAlive (via process.kill)', () => {
  it('current process PID is alive', () => {
    expect(() => process.kill(process.pid, 0)).not.toThrow()
  })

  it('very high PID is not alive', () => {
    expect(() => process.kill(999999999, 0)).toThrow()
  })
})
