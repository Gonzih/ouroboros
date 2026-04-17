import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = vi.fn()
vi.mock('../db.js', () => ({
  getDb: () => mockDb,
}))

import { log } from '../log.js'

describe('log', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  it('writes formatted message to stdout', async () => {
    mockDb.mockResolvedValueOnce([])
    await log('meta-agent', 'coordinator started')
    expect(process.stdout.write).toHaveBeenCalledWith('[meta-agent] coordinator started\n')
  })

  it('inserts log row into ouro_logs', async () => {
    mockDb.mockResolvedValueOnce([])
    await log('gateway', 'slack adapter ready')
    expect(mockDb).toHaveBeenCalledOnce()
  })

  it('swallows db errors — log failures must never crash the caller', async () => {
    mockDb.mockRejectedValueOnce(new Error('db down'))
    await expect(log('worker', 'task started')).resolves.toBeUndefined()
  })

  it('still writes to stdout even when db throws', async () => {
    mockDb.mockRejectedValueOnce(new Error('db down'))
    await log('worker', 'task started')
    expect(process.stdout.write).toHaveBeenCalledWith('[worker] task started\n')
  })
})
