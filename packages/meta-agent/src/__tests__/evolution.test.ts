import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@ouroboros/core', () => ({
  dequeue: vi.fn(),
  ack: vi.fn().mockResolvedValue(undefined),
  nack: vi.fn().mockResolvedValue(undefined),
  getDb: vi.fn(),
  log: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(undefined),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}))

vi.mock('../claude.js', () => ({
  findClaudeBin: vi.fn().mockReturnValue('claude'),
}))

import { spawnSync } from 'node:child_process'
import { dequeue, ack, nack, getDb, log, publish, releaseLock } from '@ouroboros/core'
import { processOneFeedback, pollForApproval, startEvolution } from '../loops/evolution.js'

const mockDequeue = vi.mocked(dequeue)
const mockAck = vi.mocked(ack)
const mockNack = vi.mocked(nack)
const mockGetDb = vi.mocked(getDb)
const mockLog = vi.mocked(log)
const mockPublish = vi.mocked(publish)
const mockReleaseLock = vi.mocked(releaseLock)
const mockSpawn = vi.mocked(spawnSync)

const okResult = (stdout: string) =>
  ({ status: 0, stdout, stderr: '', pid: 1, output: [], signal: null, error: undefined }) as ReturnType<typeof spawnSync>

const errResult = (stderr: string) =>
  ({ status: 1, stdout: '', stderr, pid: 1, output: [], signal: null, error: undefined }) as ReturnType<typeof spawnSync>

describe('processOneFeedback', () => {
  const savedRoot = process.env['OURO_REPO_ROOT']

  beforeEach(() => { vi.clearAllMocks() })

  afterEach(() => {
    if (savedRoot === undefined) delete process.env['OURO_REPO_ROOT']
    else process.env['OURO_REPO_ROOT'] = savedRoot
  })

  it('logs and returns early when OURO_REPO_ROOT is not set', async () => {
    delete process.env['OURO_REPO_ROOT']
    await processOneFeedback()
    expect(mockLog).toHaveBeenCalledWith('meta-agent:evolution', expect.stringContaining('OURO_REPO_ROOT'))
    expect(mockDequeue).not.toHaveBeenCalled()
  })

  it('returns immediately when queue is empty', async () => {
    process.env['OURO_REPO_ROOT'] = '/repo'
    mockDequeue.mockResolvedValueOnce(null)
    await processOneFeedback()
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('discards and acks feedback that has exceeded the retry threshold', async () => {
    process.env['OURO_REPO_ROOT'] = '/repo'
    mockDequeue.mockResolvedValueOnce({
      msgId: 99n,
      readCt: 11,
      message: { id: 'f99', text: 'some feedback', source: 'ui', status: 'pending', createdAt: new Date() },
    })
    await processOneFeedback()
    expect(mockAck).toHaveBeenCalledWith('ouro_feedback', 99n)
    expect(mockNack).not.toHaveBeenCalled()
    expect(mockSpawn).not.toHaveBeenCalled()
    expect(mockLog).toHaveBeenCalledWith(
      'meta-agent:evolution',
      expect.stringContaining('discarding feedback 99 after 11 retries'),
    )
  })

  it('nacks feedback with missing id', async () => {
    process.env['OURO_REPO_ROOT'] = '/repo'
    mockDequeue.mockResolvedValueOnce({
      msgId: 1n,
      readCt: 1,
      message: { source: 'ui', text: 'some text', status: 'pending', createdAt: new Date() } as never,
    })
    await processOneFeedback()
    expect(mockNack).toHaveBeenCalledWith('ouro_feedback', 1n)
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('nacks feedback with missing text', async () => {
    process.env['OURO_REPO_ROOT'] = '/repo'
    mockDequeue.mockResolvedValueOnce({
      msgId: 2n,
      readCt: 1,
      message: { id: 'f2', source: 'ui', status: 'pending', createdAt: new Date() } as never,
    })
    await processOneFeedback()
    expect(mockNack).toHaveBeenCalledWith('ouro_feedback', 2n)
  })

  it('nacks when claude subprocess fails', async () => {
    process.env['OURO_REPO_ROOT'] = '/repo'
    mockDequeue.mockResolvedValueOnce({
      msgId: 3n,
      readCt: 1,
      message: { id: 'f3', text: 'add feature X', source: 'ui', status: 'pending', createdAt: new Date() },
    })
    mockSpawn.mockReturnValueOnce(errResult('TypeScript error'))
    await processOneFeedback()
    expect(mockNack).toHaveBeenCalledWith('ouro_feedback', 3n)
    expect(mockLog).toHaveBeenCalledWith(
      'meta-agent:evolution',
      expect.stringContaining('claude subprocess failed'),
    )
  })

  it('nacks when claude returns BUILD_FAILED marker', async () => {
    process.env['OURO_REPO_ROOT'] = '/repo'
    mockDequeue.mockResolvedValueOnce({
      msgId: 4n,
      readCt: 1,
      message: { id: 'f4', text: 'add feature Y', source: 'ui', status: 'pending', createdAt: new Date() },
    })
    mockSpawn.mockReturnValueOnce(okResult('Tried to build...\nBUILD_FAILED:tsc error in foo.ts'))
    await processOneFeedback()
    expect(mockNack).toHaveBeenCalledWith('ouro_feedback', 4n)
    expect(mockLog).toHaveBeenCalledWith('meta-agent:evolution', expect.stringContaining('build failed'))
  })

  it('nacks when claude returns no marker', async () => {
    process.env['OURO_REPO_ROOT'] = '/repo'
    mockDequeue.mockResolvedValueOnce({
      msgId: 5n,
      readCt: 1,
      message: { id: 'f5', text: 'add feature Z', source: 'ui', status: 'pending', createdAt: new Date() },
    })
    mockSpawn.mockReturnValueOnce(okResult('Did some stuff but forgot the marker'))
    await processOneFeedback()
    expect(mockNack).toHaveBeenCalledWith('ouro_feedback', 5n)
    expect(mockLog).toHaveBeenCalledWith('meta-agent:evolution', expect.stringContaining('no marker found'))
  })

  it('updates DB and publishes when claude returns PR_OPENED', async () => {
    process.env['OURO_REPO_ROOT'] = '/repo'
    const mockDbFn = vi.fn().mockResolvedValue([])
    mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)

    mockDequeue.mockResolvedValueOnce({
      msgId: 6n,
      readCt: 1,
      message: { id: 'f6', text: 'add dark mode', source: 'ui', status: 'pending', createdAt: new Date() },
    })
    mockSpawn.mockReturnValueOnce(
      okResult('Opening PR...\nPR_OPENED:https://github.com/owner/repo/pull/42'),
    )

    await processOneFeedback()

    expect(mockDbFn).toHaveBeenCalled()
    expect(mockPublish).toHaveBeenCalledWith(
      'ouro_notify',
      expect.objectContaining({ type: 'evolution_proposed', id: 'f6' }),
    )
    expect(mockLog).toHaveBeenCalledWith(
      'meta-agent:evolution',
      expect.stringContaining('PR opened for feedback f6'),
    )
    // nack should NOT be called — message stays hidden during approval poll
    expect(mockNack).not.toHaveBeenCalled()
    expect(mockAck).not.toHaveBeenCalled()
  })

  it('passes correct args to claude subprocess', async () => {
    process.env['OURO_REPO_ROOT'] = '/my/repo'
    mockDequeue.mockResolvedValueOnce({
      msgId: 7n,
      readCt: 1,
      message: { id: 'f7', text: 'improve logging', source: 'ui', status: 'pending', createdAt: new Date() },
    })
    mockSpawn.mockReturnValueOnce(okResult('BUILD_FAILED:oops'))

    await processOneFeedback()

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      ['--print', '--dangerously-skip-permissions', '-p', expect.stringContaining('improve logging')],
      expect.objectContaining({ cwd: '/my/repo' }),
    )
  })
})

describe('pollForApproval', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitSpy: any

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    exitSpy = vi.spyOn(process, 'exit').mockReturnValue(undefined as never)
  })

  afterEach(() => {
    vi.useRealTimers()
    exitSpy.mockRestore()
  })

  it('acks and logs when feedback row is not found', async () => {
    const mockDbFn = vi.fn().mockResolvedValue([]) // SELECT returns no row → break
    mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)

    const promise = pollForApproval('f1', 'https://pr/1', 1n, '/repo')
    await vi.advanceTimersByTimeAsync(10_001)
    await promise

    expect(mockAck).toHaveBeenCalledWith('ouro_feedback', 1n)
    expect(mockLog).toHaveBeenCalledWith('meta-agent:evolution', expect.stringContaining('not found'))
  })

  it('closes PR and sets timed_out when 7-day deadline expires', async () => {
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
    // DB always returns 'pr_open' so we never approve/reject — we wait for timeout
    const mockDbFn = vi.fn().mockResolvedValue([{ status: 'pr_open' }])
    mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)
    mockSpawn.mockReturnValueOnce(okResult('Closed PR')) // close PR call on timeout

    const promise = pollForApproval('fT', 'https://pr/T', 99n, '/repo')
    // First tick: 10s passes, SELECT returns pr_open, loop continues
    await vi.advanceTimersByTimeAsync(10_001)
    // Advance past the 7-day deadline — loop exits on next while-check
    await vi.advanceTimersByTimeAsync(SEVEN_DAYS_MS + 10_001)
    await promise

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([expect.stringContaining('gh pr close https://pr/T')]),
      expect.any(Object),
    )
    expect(mockAck).toHaveBeenCalledWith('ouro_feedback', 99n)
    expect(mockPublish).toHaveBeenCalledWith('ouro_notify', expect.objectContaining({
      type: 'evolution_timeout',
      id: 'fT',
    }))
    expect(mockLog).toHaveBeenCalledWith('meta-agent:evolution', expect.stringContaining('timed out'))
  })

  it('logs poll error and continues when DB SELECT throws', async () => {
    const mockDbFn = vi.fn()
      .mockRejectedValueOnce(new Error('db timeout'))  // first poll throws
      .mockResolvedValueOnce([])                        // second poll → no row → break
    mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)

    const promise = pollForApproval('f2', 'https://pr/2', 2n, '/repo')
    await vi.advanceTimersByTimeAsync(10_001) // first poll — DB throws → logs, continues
    await vi.advanceTimersByTimeAsync(10_001) // second poll — no row → break
    await promise

    expect(mockLog).toHaveBeenCalledWith('meta-agent:evolution', expect.stringContaining('poll error'))
    expect(mockAck).toHaveBeenCalledWith('ouro_feedback', 2n)
  })

  it('rejects PR and acks when status is rejected', async () => {
    const mockDbFn = vi.fn().mockResolvedValue([{ status: 'rejected' }])
    mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)
    // close PR prompt succeeds
    mockSpawn.mockReturnValueOnce(okResult('Closed PR'))

    const promise = pollForApproval('f3', 'https://pr/3', 3n, '/repo')
    await vi.advanceTimersByTimeAsync(10_001)
    await promise

    expect(mockAck).toHaveBeenCalledWith('ouro_feedback', 3n)
    expect(mockPublish).toHaveBeenCalledWith('ouro_notify', expect.objectContaining({
      type: 'evolution_rejected',
      id: 'f3',
    }))
  })

  it('logs close PR failure but still acks when rejected and close claude call fails', async () => {
    const mockDbFn = vi.fn().mockResolvedValue([{ status: 'rejected' }])
    mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)
    // close PR claude call fails
    mockSpawn.mockReturnValueOnce(errResult('gh auth error'))

    const promise = pollForApproval('f3b', 'https://pr/3b', 30n, '/repo')
    await vi.advanceTimersByTimeAsync(10_001)
    await promise

    expect(mockLog).toHaveBeenCalledWith('meta-agent:evolution', expect.stringContaining('close PR failed'))
    expect(mockAck).toHaveBeenCalledWith('ouro_feedback', 30n)
  })

  it('merges PR, rebuilds, and exits when approved and build succeeds', async () => {
    // Throw from process.exit so the infinite poll loop terminates and the promise rejects
    exitSpy.mockImplementationOnce(() => { throw new Error('process.exit(0)') })

    const mockDbFn = vi.fn().mockResolvedValue([{ status: 'approved' }])
    mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)
    mockSpawn
      .mockReturnValueOnce(okResult('Merged'))          // gh pr merge
      .mockReturnValueOnce(okResult('Build succeeded')) // pnpm build

    const promise = pollForApproval('f4', 'https://pr/4', 4n, '/repo')
    // Pre-register rejection handler to prevent Node from firing unhandled-rejection before we assert
    promise.catch(() => undefined)

    await vi.advanceTimersByTimeAsync(10_001) // first poll — approved branch runs up to sleep(2000)
    await vi.advanceTimersByTimeAsync(2_001)  // sleep resolves → process.exit throws

    await expect(promise).rejects.toThrow('process.exit(0)')

    expect(mockAck).toHaveBeenCalledWith('ouro_feedback', 4n)
    expect(mockPublish).toHaveBeenCalledWith('ouro_notify', expect.objectContaining({
      type: 'evolution_applied',
      id: 'f4',
    }))
    expect(mockReleaseLock).toHaveBeenCalledWith('ouro:meta-agent')
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('logs merge_failed and acks when merge claude call fails', async () => {
    const mockDbFn = vi.fn().mockResolvedValue([{ status: 'approved' }])
    mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)
    mockSpawn.mockReturnValueOnce({ ...okResult(''), status: 1, stderr: 'merge error' } as ReturnType<typeof spawnSync>)

    const promise = pollForApproval('f5', 'https://pr/5', 5n, '/repo')
    await vi.advanceTimersByTimeAsync(10_001)
    await promise

    expect(mockAck).toHaveBeenCalledWith('ouro_feedback', 5n)
    expect(mockPublish).toHaveBeenCalledWith('ouro_notify', expect.objectContaining({
      type: 'evolution_merge_failed',
      id: 'f5',
    }))
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('does not restart when approved but pnpm build fails', async () => {
    const mockDbFn = vi.fn().mockResolvedValue([{ status: 'approved' }])
    mockGetDb.mockReturnValue(mockDbFn as unknown as ReturnType<typeof getDb>)
    mockSpawn
      .mockReturnValueOnce(okResult('Merged'))                                    // merge ok
      .mockReturnValueOnce({ ...okResult(''), status: 1, stderr: 'tsc error' } as ReturnType<typeof spawnSync>) // build fails

    const promise = pollForApproval('f6', 'https://pr/6', 6n, '/repo')
    await vi.advanceTimersByTimeAsync(10_001)
    await promise

    expect(mockPublish).toHaveBeenCalledWith('ouro_notify', expect.objectContaining({
      type: 'rebuild_failed',
    }))
    expect(exitSpy).not.toHaveBeenCalled()
  })
})

describe('startEvolution', () => {
  const savedRoot = process.env['OURO_REPO_ROOT']

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // startEvolution queries DB on startup to resume in-flight approval pollers;
    // return empty array so no pollers are resumed in these unit tests.
    mockGetDb.mockReturnValue(vi.fn().mockResolvedValue([]) as unknown as ReturnType<typeof getDb>)
    process.env['OURO_REPO_ROOT'] = '/test/repo'
  })

  afterEach(() => {
    vi.useRealTimers()
    if (savedRoot === undefined) delete process.env['OURO_REPO_ROOT']
    else process.env['OURO_REPO_ROOT'] = savedRoot
  })

  it('calls processOneFeedback immediately on startup', async () => {
    mockDequeue.mockResolvedValue(null)

    void startEvolution()
    // Drain: DB startup query resolves → run() called → processOneFeedback runs → dequeue called
    for (let i = 0; i < 10; i++) await Promise.resolve()

    expect(mockDequeue).toHaveBeenCalledWith('ouro_feedback', expect.any(Number))
  })

  it('logs unhandled errors from processOneFeedback without crashing', async () => {
    mockDequeue.mockRejectedValueOnce(new Error('unexpected boom'))

    void startEvolution()
    // Drain: dequeue rejects → processOneFeedback throws → .catch fires → log resolves
    for (let i = 0; i < 10; i++) await Promise.resolve()

    expect(mockLog).toHaveBeenCalledWith(
      'meta-agent:evolution',
      expect.stringContaining('unhandled error in evolution loop'),
    )
  })
})

describe('evolution prompt helpers', () => {
  it('PR_OPENED regex matches URL', () => {
    const out = 'PR_OPENED:https://github.com/owner/repo/pull/42'
    expect(/PR_OPENED:(\S+)/.exec(out)?.[1]).toBe('https://github.com/owner/repo/pull/42')
  })

  it('BUILD_FAILED regex captures error message', () => {
    const out = 'BUILD_FAILED:src/index.ts(5,3): error TS2345'
    expect(/BUILD_FAILED:(.+)/.exec(out)?.[1]).toBe('src/index.ts(5,3): error TS2345')
  })

  it('neither regex matches clean output', () => {
    const out = 'No special markers here'
    expect(/PR_OPENED:(\S+)/.exec(out)).toBeNull()
    expect(/BUILD_FAILED:(.+)/.exec(out)).toBeNull()
  })
})
