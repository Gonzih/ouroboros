import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockConn, mockDb } = vi.hoisted(() => {
  const mockConn = Object.assign(vi.fn(), { release: vi.fn() })
  const mockDb = Object.assign(vi.fn(), { reserve: vi.fn().mockResolvedValue(mockConn) })
  return { mockConn, mockDb }
})

vi.mock('../db.js', () => ({
  getDb: () => mockDb
}))

import { tryAcquireLock, releaseLock } from '../locks.js'

describe('advisory locks', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('tryAcquireLock', () => {
    it('returns true and keeps reserved connection when lock acquired', async () => {
      mockConn.mockResolvedValueOnce([{ result: true }])
      const result = await tryAcquireLock('ouro:meta-agent')
      expect(result).toBe(true)
      expect(mockDb.reserve).toHaveBeenCalledOnce()
      // Connection must NOT be released — releasing it would drop the lock
      expect(mockConn.release).not.toHaveBeenCalled()
    })

    it('returns false and releases connection when lock not acquired', async () => {
      mockConn.mockResolvedValueOnce([{ result: false }])
      const result = await tryAcquireLock('ouro:meta-agent')
      expect(result).toBe(false)
      expect(mockConn.release).toHaveBeenCalledOnce()
    })

    it('returns false and releases connection when no rows returned', async () => {
      mockConn.mockResolvedValueOnce([])
      const result = await tryAcquireLock('ouro:meta-agent')
      expect(result).toBe(false)
      expect(mockConn.release).toHaveBeenCalledOnce()
    })
  })

  describe('releaseLock', () => {
    it('unlocks and releases the reserved connection', async () => {
      // First acquire so _lockConn is set
      mockConn.mockResolvedValueOnce([{ result: true }])
      await tryAcquireLock('ouro:meta-agent')
      vi.clearAllMocks()

      mockConn.mockResolvedValueOnce([])
      await releaseLock('ouro:meta-agent')
      expect(mockConn).toHaveBeenCalledOnce() // pg_advisory_unlock
      expect(mockConn.release).toHaveBeenCalledOnce()
    })

    it('is a no-op when no lock is held', async () => {
      await expect(releaseLock('ouro:meta-agent')).resolves.toBeUndefined()
      expect(mockConn.release).not.toHaveBeenCalled()
    })
  })
})
