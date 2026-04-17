import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventEmitter as EventEmitterType } from 'node:events'
import { spawn } from 'node:child_process'

const {
  mockProc, mockStdoutRl, mockStderrRl,
  resetRlCallCount, incRlCallCount, getRlCallCount,
  mockPublish, mockDb,
} = vi.hoisted(() => {
  const { EventEmitter } = require('node:events') as typeof import('node:events')

  const proc = new EventEmitter() as EventEmitterType & {
    stdout: EventEmitterType; stderr: EventEmitterType; kill: () => void; pid: number
  }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.kill = () => undefined
  proc.pid = 9999

  let rlCount = 0
  const pub = { fn: (_ch: string, _p: unknown) => Promise.resolve() }
  const db = { fn: (..._args: unknown[]) => Promise.resolve([]) }

  return {
    mockProc: proc,
    mockStdoutRl: new EventEmitter(),
    mockStderrRl: new EventEmitter(),
    resetRlCallCount: () => { rlCount = 0 },
    incRlCallCount: () => { rlCount++ },
    getRlCallCount: () => rlCount,
    mockPublish: pub,
    mockDb: db,
  }
})

vi.mock('node:readline', () => ({
  createInterface: vi.fn().mockImplementation(() => {
    const c = getRlCallCount()
    incRlCallCount()
    return c === 0 ? mockStdoutRl : mockStderrRl
  }),
}))

vi.mock('node:child_process', () => ({
  spawn: vi.fn().mockReturnValue(mockProc),
}))

vi.mock('../backends/git.js', () => ({ gitBackend: { name: 'git', prepare: vi.fn().mockResolvedValue('/tmp/workdir'), commit: vi.fn().mockResolvedValue(undefined), cleanup: vi.fn().mockResolvedValue(undefined) } }))
vi.mock('../backends/local.js', () => ({ localBackend: { name: 'local', prepare: vi.fn().mockResolvedValue('/tmp/workdir'), commit: vi.fn().mockResolvedValue(undefined), cleanup: vi.fn().mockResolvedValue(undefined) } }))
vi.mock('../backends/s3.js', () => ({ s3Backend: { name: 's3', prepare: vi.fn().mockResolvedValue('/tmp/workdir'), commit: vi.fn().mockResolvedValue(undefined), cleanup: vi.fn().mockResolvedValue(undefined) } }))
vi.mock('../backends/gdrive.js', () => ({ gdriveBackend: { name: 'gdrive', prepare: vi.fn().mockResolvedValue('/tmp/workdir'), commit: vi.fn().mockResolvedValue(undefined), cleanup: vi.fn().mockResolvedValue(undefined) } }))
vi.mock('../backends/onedrive.js', () => ({ onedriveBackend: { name: 'onedrive', prepare: vi.fn().mockResolvedValue('/tmp/workdir'), commit: vi.fn().mockResolvedValue(undefined), cleanup: vi.fn().mockResolvedValue(undefined) } }))

vi.mock('@ouroboros/core', () => ({
  getDb: () => ((...args: unknown[]) => mockDb.fn(...args)),
  publish: (...args: unknown[]) => mockPublish.fn(args[0] as string, args[1]),
  log: vi.fn().mockResolvedValue(undefined),
  registerProcess: vi.fn().mockResolvedValue(undefined),
  unregisterProcess: vi.fn().mockResolvedValue(undefined),
  setJobSession: vi.fn().mockResolvedValue(undefined),
  setJobHeartbeat: vi.fn().mockResolvedValue(undefined),
  heartbeat: vi.fn().mockResolvedValue(undefined),
}))

import { run } from '../run.js'

function tick(n = 4): Promise<void> {
  let p = Promise.resolve()
  for (let i = 0; i < n; i++) p = p.then(() => new Promise(resolve => setImmediate(resolve)))
  return p
}

describe('worker run — output line publish', () => {
  const publishCalls: Array<[string, unknown]> = []

  beforeEach(() => {
    vi.clearAllMocks()
    mockStdoutRl.removeAllListeners()
    mockStderrRl.removeAllListeners()
    mockProc.removeAllListeners()
    resetRlCallCount()
    publishCalls.length = 0
    mockDb.fn = () => Promise.resolve([])
    mockPublish.fn = (ch: string, p: unknown) => {
      publishCalls.push([ch, p])
      return Promise.resolve()
    }
  })

  it('publishes job_output_appended notification for each output line', async () => {
    process.env['OURO_TASK'] = JSON.stringify({
      id: 'test-job-id',
      backend: 'local',
      target: '/tmp/test',
      instructions: 'do the thing',
    })

    const runPromise = run()
    await tick(6)

    mockStdoutRl.emit('line', 'some output line')
    await tick(6)

    mockStdoutRl.emit('line', 'TASK_DONE')
    await tick(6)

    mockProc.emit('close', 0)
    await runPromise.catch(() => undefined)

    const outputCalls = publishCalls.filter(
      ([ch, p]) => ch === 'ouro_notify' && (p as Record<string, unknown>)['type'] === 'job_output_appended'
    )
    expect(outputCalls.length).toBeGreaterThan(0)

    const ourLine = outputCalls.find(
      ([, p]) => {
        const payload = p as Record<string, unknown>
        return payload['line'] === 'some output line' && payload['jobId'] === 'test-job-id'
      }
    )
    expect(ourLine).toBeDefined()
  })
})

describe('worker run — session resumption (--continue)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStdoutRl.removeAllListeners()
    mockStderrRl.removeAllListeners()
    mockProc.removeAllListeners()
    resetRlCallCount()
    mockDb.fn = () => Promise.resolve([])
    mockPublish.fn = () => Promise.resolve()
  })

  it('uses --continue when sessionId is present in task', async () => {
    process.env['OURO_TASK'] = JSON.stringify({
      id: 'resume-job',
      backend: 'local',
      target: '/tmp/test',
      instructions: 'resume work',
      sessionId: 'existing-session-abc',
    })

    const runPromise = run()
    await tick(6)
    mockStdoutRl.emit('line', 'TASK_DONE')
    await tick(6)
    mockProc.emit('close', 0)
    await runPromise

    const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1] as string[]
    expect(spawnArgs).toContain('--continue')
  })

  it('does not use --continue on fresh dispatch', async () => {
    process.env['OURO_TASK'] = JSON.stringify({
      id: 'fresh-job',
      backend: 'local',
      target: '/tmp/test',
      instructions: 'fresh work',
    })

    const runPromise = run()
    await tick(6)
    mockStdoutRl.emit('line', 'TASK_DONE')
    await tick(6)
    mockProc.emit('close', 0)
    await runPromise

    const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1] as string[]
    expect(spawnArgs).not.toContain('--continue')
  })
})

describe('worker run — completion status publishing', () => {
  const publishCalls: Array<[string, unknown]> = []

  beforeEach(() => {
    vi.clearAllMocks()
    mockStdoutRl.removeAllListeners()
    mockStderrRl.removeAllListeners()
    mockProc.removeAllListeners()
    resetRlCallCount()
    publishCalls.length = 0
    mockDb.fn = () => Promise.resolve([])
    mockPublish.fn = (ch: string, p: unknown) => {
      publishCalls.push([ch, p])
      return Promise.resolve()
    }
  })

  it('publishes job_complete with completed status on TASK_DONE', async () => {
    process.env['OURO_TASK'] = JSON.stringify({
      id: 'done-job',
      backend: 'local',
      target: '/tmp/test',
      instructions: 'do the thing',
    })

    const runPromise = run()
    await tick(6)
    mockStdoutRl.emit('line', 'TASK_DONE')
    await tick(6)
    mockProc.emit('close', 0)
    await runPromise

    const completeCall = publishCalls.find(
      ([ch, p]) => ch === 'ouro_notify' && (p as Record<string, unknown>)['type'] === 'job_complete'
    )
    expect(completeCall).toBeDefined()
    expect((completeCall![1] as Record<string, unknown>)['status']).toBe('completed')
    expect((completeCall![1] as Record<string, unknown>)['jobId']).toBe('done-job')
  })

  it('publishes job_complete with failed status on TASK_FAILED line', async () => {
    process.env['OURO_TASK'] = JSON.stringify({
      id: 'fail-job',
      backend: 'local',
      target: '/tmp/test',
      instructions: 'do the thing',
    })

    const runPromise = run()
    await tick(6)
    mockStdoutRl.emit('line', 'TASK_FAILED:could not complete')
    await tick(6)
    mockProc.emit('close', 0)
    await runPromise

    const completeCall = publishCalls.find(
      ([ch, p]) => ch === 'ouro_notify' && (p as Record<string, unknown>)['type'] === 'job_complete'
    )
    expect(completeCall).toBeDefined()
    expect((completeCall![1] as Record<string, unknown>)['status']).toBe('failed')
  })

  it('publishes job_complete with failed status on non-zero claude exit', async () => {
    process.env['OURO_TASK'] = JSON.stringify({
      id: 'crash-job',
      backend: 'local',
      target: '/tmp/test',
      instructions: 'do the thing',
    })

    const runPromise = run()
    await tick(6)
    mockStderrRl.emit('line', 'fatal: permission denied')
    await tick(2)
    mockProc.emit('close', 1)
    await runPromise

    const completeCall = publishCalls.find(
      ([ch, p]) => ch === 'ouro_notify' && (p as Record<string, unknown>)['type'] === 'job_complete'
    )
    expect(completeCall).toBeDefined()
    expect((completeCall![1] as Record<string, unknown>)['status']).toBe('failed')
  })
})

describe('worker run — edge cases', () => {
  const publishCalls: Array<[string, unknown]> = []

  beforeEach(() => {
    vi.clearAllMocks()
    mockStdoutRl.removeAllListeners()
    mockStderrRl.removeAllListeners()
    mockProc.removeAllListeners()
    resetRlCallCount()
    publishCalls.length = 0
    mockDb.fn = () => Promise.resolve([])
    mockPublish.fn = (ch: string, p: unknown) => {
      publishCalls.push([ch, p])
      return Promise.resolve()
    }
  })

  it('fails with "no output from claude" when process exits cleanly without any output', async () => {
    process.env['OURO_TASK'] = JSON.stringify({
      id: 'silent-job',
      backend: 'local',
      target: '/tmp/test',
      instructions: 'do the thing',
    })

    const runPromise = run()
    await tick(6)
    // No stdout lines emitted — process exits with code 0
    mockProc.emit('close', 0)
    await runPromise

    const completeCall = publishCalls.find(
      ([ch, p]) => ch === 'ouro_notify' && (p as Record<string, unknown>)['type'] === 'job_complete'
    )
    expect(completeCall).toBeDefined()
    expect((completeCall![1] as Record<string, unknown>)['status']).toBe('failed')
  })

  it('logs cleanup failure when backend.cleanup throws', async () => {
    const { localBackend } = await import('../backends/local.js')
    vi.mocked(localBackend.cleanup).mockRejectedValueOnce(new Error('cleanup ENOENT'))

    process.env['OURO_TASK'] = JSON.stringify({
      id: 'cleanup-fail-job',
      backend: 'local',
      target: '/tmp/test',
      instructions: 'do the thing',
    })

    const runPromise = run()
    await tick(6)
    mockStdoutRl.emit('line', 'TASK_DONE')
    await tick(6)
    mockProc.emit('close', 0)
    await runPromise

    const { log: mockLogFn } = await import('@ouroboros/core')
    expect(vi.mocked(mockLogFn)).toHaveBeenCalledWith(
      'worker',
      expect.stringContaining('cleanup failed'),
    )
  })
})

describe('worker run — input validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.fn = () => Promise.resolve([])
    mockPublish.fn = () => Promise.resolve()
  })

  it('throws when OURO_TASK env var is not set', async () => {
    delete process.env['OURO_TASK']
    await expect(run()).rejects.toThrow('OURO_TASK env var is required')
  })

  it('throws when OURO_TASK is not valid JSON', async () => {
    process.env['OURO_TASK'] = 'not-valid-json'
    await expect(run()).rejects.toThrow(/failed to parse OURO_TASK/)
  })

  it('throws on unknown backend name', async () => {
    process.env['OURO_TASK'] = JSON.stringify({
      id: 'j1', backend: 'mongodb', target: '/tmp', instructions: 'go',
    })
    await expect(run()).rejects.toThrow('unknown backend: mongodb')
  })
})
