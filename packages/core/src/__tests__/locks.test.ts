import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = vi.fn()
vi.mock('../db.js', () => ({
  getDb: () => mockDb
}))

import { tryAcquireLock, releaseLock } from '../locks.js'

describe('advisory locks', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('tryAcquireLock', () => {
    it('returns true when pg_try_advisory_lock returns true', async () => {
      mockDb.mockResolvedValueOnce([{ result: true }])
      const result = await tryAcquireLock('ouro:meta-agent')
      expect(result).toBe(true)
    })

    it('returns false when pg_try_advisory_lock returns false', async () => {
      mockDb.mockResolvedValueOnce([{ result: false }])
      const result = await tryAcquireLock('ouro:meta-agent')
      expect(result).toBe(false)
    })

    it('returns false when no rows returned', async () => {
      mockDb.mockResolvedValueOnce([])
      const result = await tryAcquireLock('ouro:meta-agent')
      expect(result).toBe(false)
    })
  })

  describe('releaseLock', () => {
    it('calls db without throwing', async () => {
      mockDb.mockResolvedValueOnce([])
      await expect(releaseLock('ouro:meta-agent')).resolves.toBeUndefined()
      expect(mockDb).toHaveBeenCalledOnce()
    })
  })
})
