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

import { dequeue, nack, log, publish, ack } from '@ouroboros/core'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { startWorkerDispatch } from '../loops/worker-dispatch.js'

const mockDequeue = vi.mocked(dequeue)
const mockNack = vi.mocked(nack)
const mockAck = vi.mocked(ack)
const mockSpawn = vi.mocked(spawn)
const mockLog = vi.mocked(log)
const mockPublish = vi.mocked(publish)
const mockCreateInterface = vi.mocked(createInterface)

function makeFakeProc() {
  return { stdout: {}, stderr: {}, on: vi.fn(), kill: vi.fn(), pid: 98765 }
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

  it('skips dequeue when at max worker capacity', async () => {
    const savedMax = process.env['OURO_MAX_WORKERS']
    process.env['OURO_MAX_WORKERS'] = '0'
    void startWorkerDispatch()
    await flush()
    expect(mockDequeue).not.toHaveBeenCalled()
    if (savedMax === undefined) delete process.env['OURO_MAX_WORKERS']
    else process.env['OURO_MAX_WORKERS'] = savedMax
  })

  it('logs poll errors without crashing', async () => {
    mockDequeue.mockRejectedValueOnce(new Error('db connection lost'))
    void startWorkerDispatch()
    await flush()
    expect(mockLog).toHaveBeenCalledWith(
      'meta-agent:worker-dispatch',
      expect.stringContaining('poll error'),
    )
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

  it('acks the message when worker process exits with code 0', async () => {
    process.env['OURO_MAX_WORKERS'] = '10'
    const fakeProc = makeFakeProc()
    mockSpawn.mockReturnValue(fakeProc as unknown as ReturnType<typeof spawn>)
    mockDequeue.mockResolvedValueOnce({
      msgId: 49n,
      message: { id: 'job-clean-exit', backend: 'local', target: '/tmp', instructions: 'run' },
    })
    void startWorkerDispatch()
    await flush(20)

    const closeCbCall = fakeProc.on.mock.calls.find(([e]) => e === 'close')
    expect(closeCbCall).toBeDefined()
    const closeCb = closeCbCall![1] as (code: number) => void
    closeCb(0)
    await flush(20)

    expect(mockAck).toHaveBeenCalledWith('ouro_tasks', 49n)
    delete process.env['OURO_MAX_WORKERS']
  })

  it('inserts output lines through readline on-line handler', async () => {
    process.env['OURO_MAX_WORKERS'] = '10'
    const fakeProc = makeFakeProc()
    mockSpawn.mockReturnValue(fakeProc as unknown as ReturnType<typeof spawn>)
    mockDequeue.mockResolvedValueOnce({
      msgId: 48n,
      message: { id: 'job-readline', backend: 'local', target: '/tmp', instructions: 'run' },
    })
    void startWorkerDispatch()
    await flush(20)

    // createInterface mock returns the same { on: vi.fn() } object for each call;
    // the first 'line' callback registered is the stdout handler
    const rlMock = mockCreateInterface.mock.results[0]?.value as { on: ReturnType<typeof vi.fn> }
    expect(rlMock).toBeDefined()
    const lineCbCall = rlMock.on.mock.calls.find(([e]) => e === 'line')
    expect(lineCbCall).toBeDefined()
    const lineCb = lineCbCall![1] as (line: string) => void

    mockDb.mockClear()
    lineCb('hello from worker')
    await flush(10)

    // insertOutputLine calls db as a tagged template — verify it was invoked
    expect(mockDb).toHaveBeenCalled()
    delete process.env['OURO_MAX_WORKERS']
  })

  it('nacks and logs when worker process exits with non-zero code', async () => {
    process.env['OURO_MAX_WORKERS'] = '10'
    const fakeProc = makeFakeProc()
    mockSpawn.mockReturnValue(fakeProc as unknown as ReturnType<typeof spawn>)
    mockDequeue.mockResolvedValueOnce({
      msgId: 50n,
      message: { id: 'job-close-fail', backend: 'local', target: '/tmp', instructions: 'run' },
    })
    void startWorkerDispatch()
    await flush(20)

    const closeCbCall = fakeProc.on.mock.calls.find(([e]) => e === 'close')
    expect(closeCbCall).toBeDefined()
    const closeCb = closeCbCall![1] as (code: number) => void
    closeCb(1)
    await flush(20)

    expect(mockNack).toHaveBeenCalledWith('ouro_tasks', 50n)
    expect(mockLog).toHaveBeenCalledWith(
      'meta-agent:worker-dispatch',
      expect.stringContaining('job-close-fail failed'),
    )
    delete process.env['OURO_MAX_WORKERS']
  })

  it('nacks and logs when worker process emits an error event', async () => {
    process.env['OURO_MAX_WORKERS'] = '10'
    const fakeProc = makeFakeProc()
    mockSpawn.mockReturnValue(fakeProc as unknown as ReturnType<typeof spawn>)
    mockDequeue.mockResolvedValueOnce({
      msgId: 51n,
      message: { id: 'job-spawn-err', backend: 'local', target: '/tmp', instructions: 'run' },
    })
    void startWorkerDispatch()
    await flush(20)

    const errCbCall = fakeProc.on.mock.calls.find(([e]) => e === 'error')
    expect(errCbCall).toBeDefined()
    const errCb = errCbCall![1] as (err: Error) => void
    errCb(new Error('spawn ENOENT'))
    await flush(20)

    expect(mockNack).toHaveBeenCalledWith('ouro_tasks', 51n)
    expect(mockLog).toHaveBeenCalledWith(
      'meta-agent:worker-dispatch',
      expect.stringContaining('failed to spawn worker for job job-spawn-err'),
    )
    delete process.env['OURO_MAX_WORKERS']
  })

  it('kills active worker and marks cancelled when cancellation is requested', async () => {
    process.env['OURO_MAX_WORKERS'] = '10'
    const fakeProc = makeFakeProc()
    mockSpawn.mockReturnValue(fakeProc as unknown as ReturnType<typeof spawn>)
    mockDequeue.mockResolvedValueOnce({
      msgId: 52n,
      message: { id: 'job-to-cancel', backend: 'local', target: '/tmp', instructions: 'run' },
    })
    void startWorkerDispatch()
    await flush(20)
    // Worker is now in activeWorkers — advance to next cancel check cycle
    mockDb
      .mockResolvedValueOnce([{ id: 'job-to-cancel' }])  // SELECT cancellation_requested
      .mockResolvedValueOnce([])                          // UPDATE to cancelled
    await vi.advanceTimersByTimeAsync(3001)
    await flush(20)

    expect(fakeProc.kill).toHaveBeenCalledWith('SIGTERM')
    expect(mockPublish).toHaveBeenCalledWith(
      'ouro_notify',
      expect.objectContaining({ type: 'job_complete', jobId: 'job-to-cancel', status: 'cancelled' }),
    )
    expect(mockLog).toHaveBeenCalledWith(
      'meta-agent:worker-dispatch',
      expect.stringContaining('cancelled job job-to-cancel'),
    )
    delete process.env['OURO_MAX_WORKERS']
  })

  it('logs ack failure when ack rejects after successful worker exit', async () => {
    process.env['OURO_MAX_WORKERS'] = '10'
    const fakeProc = makeFakeProc()
    mockSpawn.mockReturnValue(fakeProc as unknown as ReturnType<typeof spawn>)
    mockAck.mockRejectedValueOnce(new Error('ack network error'))
    mockDequeue.mockResolvedValueOnce({
      msgId: 55n,
      message: { id: 'job-ack-fail', backend: 'local', target: '/tmp', instructions: 'run' },
    })
    void startWorkerDispatch()
    await flush(20)

    const closeCbCall = fakeProc.on.mock.calls.find(([e]) => e === 'close')
    const closeCb = closeCbCall![1] as (code: number) => void
    closeCb(0)
    await flush(20)

    expect(mockLog).toHaveBeenCalledWith(
      'meta-agent:worker-dispatch',
      expect.stringContaining('ack failed for job job-ack-fail'),
    )
    delete process.env['OURO_MAX_WORKERS']
  })

  it('logs nack failure when nack rejects after failed worker exit', async () => {
    process.env['OURO_MAX_WORKERS'] = '10'
    const fakeProc = makeFakeProc()
    mockSpawn.mockReturnValue(fakeProc as unknown as ReturnType<typeof spawn>)
    mockNack.mockRejectedValueOnce(new Error('nack network error'))
    mockDequeue.mockResolvedValueOnce({
      msgId: 56n,
      message: { id: 'job-nack-fail', backend: 'local', target: '/tmp', instructions: 'run' },
    })
    void startWorkerDispatch()
    await flush(20)

    const closeCbCall = fakeProc.on.mock.calls.find(([e]) => e === 'close')
    const closeCb = closeCbCall![1] as (code: number) => void
    closeCb(1)
    await flush(20)

    expect(mockLog).toHaveBeenCalledWith(
      'meta-agent:worker-dispatch',
      expect.stringContaining('nack failed for job job-nack-fail'),
    )
    delete process.env['OURO_MAX_WORKERS']
  })

  it('uses last collected stderr line as error message on non-zero exit', async () => {
    process.env['OURO_MAX_WORKERS'] = '10'
    const fakeProc = makeFakeProc()
    mockSpawn.mockReturnValue(fakeProc as unknown as ReturnType<typeof spawn>)
    mockDequeue.mockResolvedValueOnce({
      msgId: 57n,
      message: { id: 'job-stderr-err', backend: 'local', target: '/tmp', instructions: 'run' },
    })
    void startWorkerDispatch()
    await flush(20)

    // Both rl and rlErr receive the same shared mock object; 'line' is registered twice —
    // calls[0] = stdout handler, calls[1] = stderr handler.
    const rlOnMock = (mockCreateInterface.mock.results[0]?.value as { on: ReturnType<typeof vi.fn> }).on
    const lineCalls = rlOnMock.mock.calls.filter(([e]) => e === 'line')
    const stderrLineCb = lineCalls[1]?.[1] as ((line: string) => void) | undefined
    expect(stderrLineCb).toBeDefined()
    stderrLineCb!('Fatal error: out of memory')
    await flush()

    const closeCbCall = fakeProc.on.mock.calls.find(([e]) => e === 'close')
    const closeCb = closeCbCall![1] as (code: number) => void
    closeCb(1)
    await flush(20)

    expect(mockLog).toHaveBeenCalledWith(
      'meta-agent:worker-dispatch',
      expect.stringContaining('Fatal error: out of memory'),
    )
    delete process.env['OURO_MAX_WORKERS']
  })

  it('logs error when cancellation DB query throws', async () => {
    process.env['OURO_MAX_WORKERS'] = '10'
    const fakeProc = makeFakeProc()
    mockSpawn.mockReturnValue(fakeProc as unknown as ReturnType<typeof spawn>)
    mockDequeue.mockResolvedValueOnce({
      msgId: 53n,
      message: { id: 'job-cancel-dberr', backend: 'local', target: '/tmp', instructions: 'run' },
    })
    void startWorkerDispatch()
    await flush(20)
    // Make the DB throw on the next cancel check
    mockDb.mockRejectedValueOnce(new Error('db timeout'))
    await vi.advanceTimersByTimeAsync(3001)
    await flush(20)

    expect(mockLog).toHaveBeenCalledWith(
      'meta-agent:worker-dispatch',
      expect.stringContaining('cancellation check error'),
    )
    delete process.env['OURO_MAX_WORKERS']
  })

  it('falls back to import.meta.url path when OURO_REPO_ROOT is not set', async () => {
    const savedRoot = process.env['OURO_REPO_ROOT']
    delete process.env['OURO_REPO_ROOT']
    process.env['OURO_MAX_WORKERS'] = '100'
    mockDequeue.mockResolvedValueOnce({
      msgId: 61n,
      message: { id: 'job-fallback-path', backend: 'local', target: '/tmp', instructions: 'go' },
    })
    void startWorkerDispatch()
    await flush(20)
    const workerPath = (mockSpawn.mock.calls[0]![1] as string[])[0]!
    expect(workerPath).toContain('worker')
    expect(workerPath).toContain('dist')
    if (savedRoot === undefined) delete process.env['OURO_REPO_ROOT']
    else process.env['OURO_REPO_ROOT'] = savedRoot
    delete process.env['OURO_MAX_WORKERS']
  })

  it('writes to stderr when insertOutputLine db insert fails', async () => {
    process.env['OURO_MAX_WORKERS'] = '100'
    const fakeProc = makeFakeProc()
    mockSpawn.mockReturnValue(fakeProc as unknown as ReturnType<typeof spawn>)
    mockDequeue.mockResolvedValueOnce({
      msgId: 62n,
      message: { id: 'job-output-err', backend: 'local', target: '/tmp', instructions: 'run' },
    })
    void startWorkerDispatch()
    await flush(20)

    const rlMock = mockCreateInterface.mock.results[0]?.value as { on: ReturnType<typeof vi.fn> }
    const lineCbCall = rlMock.on.mock.calls.find(([e]) => e === 'line')
    const lineCb = lineCbCall![1] as (line: string) => void

    mockDb.mockRejectedValueOnce(new Error('db write failed'))
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    lineCb('output line that triggers db failure')
    await flush(10)

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('failed to insert output'))
    stderrSpy.mockRestore()
    delete process.env['OURO_MAX_WORKERS']
  })
})
