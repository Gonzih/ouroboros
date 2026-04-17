import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = vi.fn()
vi.mock('../db.js', () => ({
  getDb: () => mockDb,
}))

const mockPublish = vi.fn()
vi.mock('../events.js', () => ({
  publish: (...args: unknown[]) => mockPublish(...args),
}))

import { log } from '../log.js'

describe('log', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  it('writes formatted message to stdout', async () => {
    mockDb.mockResolvedValueOnce([{ id: 1, ts: '2026-01-01T00:00:00Z' }])
    mockPublish.mockResolvedValueOnce(undefined)
    await log('meta-agent', 'coordinator started')
    expect(process.stdout.write).toHaveBeenCalledWith('[meta-agent] coordinator started\n')
  })

  it('inserts log row into ouro_logs', async () => {
    mockDb.mockResolvedValueOnce([{ id: 2, ts: '2026-01-01T00:00:00Z' }])
    mockPublish.mockResolvedValueOnce(undefined)
    await log('gateway', 'slack adapter ready')
    expect(mockDb).toHaveBeenCalledOnce()
  })

  it('publishes log_entry event to ouro_notify after insert', async () => {
    const ts = '2026-04-17T06:00:00.000Z'
    mockDb.mockResolvedValueOnce([{ id: 42, ts }])
    mockPublish.mockResolvedValueOnce(undefined)
    await log('ui', 'server listening on port 7702')
    expect(mockPublish).toHaveBeenCalledWith('ouro_notify', {
      type: 'log_entry',
      id: 42,
      source: 'ui',
      message: 'server listening on port 7702',
      ts,
    })
  })

  it('does not publish when insert returns no row', async () => {
    mockDb.mockResolvedValueOnce([])
    await log('gateway', 'no row returned')
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('swallows db errors — log failures must never crash the caller', async () => {
    mockDb.mockRejectedValueOnce(new Error('db down'))
    await expect(log('worker', 'task started')).resolves.toBeUndefined()
  })

  it('swallows publish errors — log failures must never crash the caller', async () => {
    mockDb.mockResolvedValueOnce([{ id: 5, ts: '2026-01-01T00:00:00Z' }])
    mockPublish.mockRejectedValueOnce(new Error('pg notify down'))
    await expect(log('worker', 'task done')).resolves.toBeUndefined()
  })

  it('still writes to stdout even when db throws', async () => {
    mockDb.mockRejectedValueOnce(new Error('db down'))
    await log('worker', 'task started')
    expect(process.stdout.write).toHaveBeenCalledWith('[worker] task started\n')
  })
})
