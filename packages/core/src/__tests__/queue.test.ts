import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = vi.fn()
vi.mock('../db.js', () => ({
  getDb: () => mockDb
}))

import { enqueue, dequeue, ack, nack } from '../queue.js'

describe('queue helpers', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('enqueue', () => {
    it('returns a bigint on success', async () => {
      mockDb.mockResolvedValueOnce([{ msg_id: '42' }])
      const result = await enqueue('test_queue', { hello: 'world' })
      expect(result).toBe(42n)
    })

    it('throws when pgmq.send returns no rows', async () => {
      mockDb.mockResolvedValueOnce([])
      await expect(enqueue('test_queue', {})).rejects.toThrow('pgmq.send returned no rows')
    })
  })

  describe('dequeue', () => {
    it('returns null when queue is empty', async () => {
      mockDb.mockResolvedValueOnce([])
      const result = await dequeue('test_queue')
      expect(result).toBeNull()
    })

    it('returns msgId and message when a row is present', async () => {
      const msg = { id: 'abc', backend: 'git', target: 'repo', instructions: 'do it' }
      mockDb.mockResolvedValueOnce([{ msg_id: '7', message: msg }])
      const result = await dequeue('test_queue')
      expect(result).not.toBeNull()
      expect(result!.msgId).toBe(7n)
      expect(result!.message).toEqual(msg)
    })
  })

  describe('ack', () => {
    it('calls db without throwing', async () => {
      mockDb.mockResolvedValueOnce([])
      await expect(ack('test_queue', 5n)).resolves.toBeUndefined()
      expect(mockDb).toHaveBeenCalledOnce()
    })
  })

  describe('nack', () => {
    it('calls db without throwing', async () => {
      mockDb.mockResolvedValueOnce([])
      await expect(nack('test_queue', 5n)).resolves.toBeUndefined()
      expect(mockDb).toHaveBeenCalledOnce()
    })
  })
})
