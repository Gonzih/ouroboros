import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventEmitter as EventEmitterType } from 'node:events'

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
