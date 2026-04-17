import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockDb = vi.fn().mockResolvedValue([])

vi.mock('@ouroboros/core', () => ({
  dequeue: vi.fn().mockResolvedValue(null),
  ack: vi.fn().mockResolvedValue(undefined),
  nack: vi.fn().mockResolvedValue(undefined),
  getDb: () => mockDb,
  log: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('node:readline', () => ({
  createInterface: vi.fn().mockReturnValue({ on: vi.fn() }),
}))

import { dequeue, nack } from '@ouroboros/core'
import { spawn } from 'node:child_process'
import { startWorkerDispatch } from '../loops/worker-dispatch.js'

const mockDequeue = vi.mocked(dequeue)
const mockNack = vi.mocked(nack)
const mockSpawn = vi.mocked(spawn)

function makeFakeProc() {
  return { stdout: {}, stderr: {}, on: vi.fn(), pid: 98765 }
}

// Flush the microtask queue so async poll callbacks complete
async function flush(n = 15): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

describe('worker-dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockDb.mockResolvedValue([])
    mockDequeue.mockResolvedValue(null)
    mockSpawn.mockReturnValue(makeFakeProc() as unknown as ReturnType<typeof spawn>)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls the ouro_tasks queue on startup', async () => {
    void startWorkerDispatch()
    await flush()
    expect(mockDequeue).toHaveBeenCalledWith('ouro_tasks', expect.any(Number))
  })

  it('does nothing when the queue is empty', async () => {
    mockDequeue.mockResolvedValue(null)
    void startWorkerDispatch()
    await flush()
    expect(mockNack).not.toHaveBeenCalled()
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('nacks a message with an invalid task shape', async () => {
    mockDequeue.mockResolvedValueOnce({ msgId: 42n, message: { invalid: true } })
    void startWorkerDispatch()
    await flush()
    expect(mockNack).toHaveBeenCalledWith('ouro_tasks', 42n)
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('nacks a non-object message', async () => {
    mockDequeue.mockResolvedValueOnce({ msgId: 7n, message: 'not-an-object' })
    void startWorkerDispatch()
    await flush()
    expect(mockNack).toHaveBeenCalledWith('ouro_tasks', 7n)
  })

  it('nacks a message missing required fields', async () => {
    // id and instructions are present but backend and target are missing
    mockDequeue.mockResolvedValueOnce({
      msgId: 5n,
      message: { id: 'j1', instructions: 'do stuff' },
    })
    void startWorkerDispatch()
    await flush()
    expect(mockNack).toHaveBeenCalledWith('ouro_tasks', 5n)
  })

  it('spawns a node process for a valid task', async () => {
    mockDequeue.mockResolvedValueOnce({
      msgId: 1n,
      message: { id: 'job-1', backend: 'local', target: '/tmp/work', instructions: 'run' },
    })
    void startWorkerDispatch()
    await flush(20)
    expect(mockSpawn).toHaveBeenCalledWith(
      'node',
      expect.arrayContaining([expect.stringContaining('worker')]),
      expect.objectContaining({ env: expect.objectContaining({ OURO_TASK: expect.any(String) }) }),
    )
  })

  it('passes task as JSON in the OURO_TASK env var', async () => {
    const task = { id: 'job-2', backend: 'git', target: 'https://github.com/x/y', instructions: 'check PRs' }
    mockDequeue.mockResolvedValueOnce({ msgId: 2n, message: task })
    void startWorkerDispatch()
    await flush(20)
    const spawnCall = mockSpawn.mock.calls[0]!
    const env = (spawnCall[2] as { env: Record<string, string> }).env
    expect(JSON.parse(env['OURO_TASK']!)).toMatchObject(task)
  })

  it('uses OURO_REPO_ROOT to locate the worker binary when set', async () => {
    const savedRoot = process.env['OURO_REPO_ROOT']
    process.env['OURO_REPO_ROOT'] = '/my/repo'
    mockDequeue.mockResolvedValueOnce({
      msgId: 3n,
      message: { id: 'job-3', backend: 'local', target: '/tmp', instructions: 'go' },
    })
    void startWorkerDispatch()
    await flush(20)
    const workerPath = (mockSpawn.mock.calls[0]![1] as string[])[0]!
    expect(workerPath).toContain('/my/repo')
    expect(workerPath).toContain('worker')
    if (savedRoot === undefined) delete process.env['OURO_REPO_ROOT']
    else process.env['OURO_REPO_ROOT'] = savedRoot
  })
})
