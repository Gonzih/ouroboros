import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@ouroboros/core', () => ({
  subscribe: vi.fn().mockResolvedValue(() => undefined),
  log: vi.fn().mockResolvedValue(undefined),
}))

import { subscribe, log } from '@ouroboros/core'
import { Gateway } from '../gateway.js'
import type { ChannelAdapter } from '../adapters/log.js'

function makeMockAdapter(name: string): ChannelAdapter & { send: ReturnType<typeof vi.fn>, start: ReturnType<typeof vi.fn>, stop: ReturnType<typeof vi.fn> } {
  return {
    name,
    send: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  }
}

describe('Gateway', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('broadcast', () => {
    it('calls send on all adapters', async () => {
      const a1 = makeMockAdapter('a1')
      const a2 = makeMockAdapter('a2')
      const gateway = new Gateway([a1, a2])

      await gateway.broadcast('hello world')

      expect(a1.send).toHaveBeenCalledWith('hello world')
      expect(a2.send).toHaveBeenCalledWith('hello world')
    })

    it('continues broadcasting even if one adapter throws', async () => {
      const a1 = makeMockAdapter('a1')
      const a2 = makeMockAdapter('a2')
      a1.send.mockRejectedValue(new Error('send failed'))

      const gateway = new Gateway([a1, a2])
      // Should not throw
      await expect(gateway.broadcast('test')).resolves.toBeUndefined()
      // a2 should still have been called
      expect(a2.send).toHaveBeenCalledWith('test')
    })
  })

  describe('start', () => {
    it('calls start on all adapters', async () => {
      const a1 = makeMockAdapter('a1')
      const a2 = makeMockAdapter('a2')
      const gateway = new Gateway([a1, a2])

      await gateway.start()

      expect(a1.start).toHaveBeenCalled()
      expect(a2.start).toHaveBeenCalled()
    })

    it('subscribes to ouro_notify channel', async () => {
      const adapter = makeMockAdapter('log')
      const gateway = new Gateway([adapter])

      await gateway.start()

      expect(subscribe).toHaveBeenCalledWith('ouro_notify', expect.any(Function))
    })

    it('formats mcp_registered event and broadcasts it', async () => {
      const adapter = makeMockAdapter('log')
      const gateway = new Gateway([adapter])

      let capturedCb: ((payload: unknown) => Promise<void>) | null = null
      vi.mocked(subscribe).mockImplementationOnce(async (_ch, cb) => {
        capturedCb = cb as (payload: unknown) => Promise<void>
        return () => undefined
      })

      await gateway.start()

      expect(capturedCb).not.toBeNull()

      await capturedCb!({
        type: 'mcp_registered',
        name: 'my-db',
        status: 'operational',
        toolsFound: ['query_database', 'list_tables']
      })

      expect(adapter.send).toHaveBeenCalledWith(
        expect.stringContaining('my-db')
      )
      expect(adapter.send).toHaveBeenCalledWith(
        expect.stringContaining('operational')
      )
    })

    it('formats job_complete event and broadcasts it', async () => {
      const adapter = makeMockAdapter('log')
      const gateway = new Gateway([adapter])

      let capturedCb: ((payload: unknown) => Promise<void>) | null = null
      vi.mocked(subscribe).mockImplementationOnce(async (_ch, cb) => {
        capturedCb = cb as (payload: unknown) => Promise<void>
        return () => undefined
      })

      await gateway.start()

      await capturedCb!({
        type: 'job_complete',
        jobId: 'j-123',
        status: 'completed',
      })

      expect(adapter.send).toHaveBeenCalledWith(
        expect.stringContaining('j-123')
      )
    })

    it('ignores payloads without type field', async () => {
      const adapter = makeMockAdapter('log')
      const gateway = new Gateway([adapter])

      let capturedCb: ((payload: unknown) => Promise<void>) | null = null
      vi.mocked(subscribe).mockImplementationOnce(async (_ch, cb) => {
        capturedCb = cb as (payload: unknown) => Promise<void>
        return () => undefined
      })

      await gateway.start()
      await capturedCb!({ not_a_type: 'foo' })

      expect(adapter.send).not.toHaveBeenCalled()
    })

    it('formats evolution_result event and broadcasts it', async () => {
      const adapter = makeMockAdapter('log')
      const gateway = new Gateway([adapter])

      let capturedCb: ((payload: unknown) => Promise<void>) | null = null
      vi.mocked(subscribe).mockImplementationOnce(async (_ch, cb) => {
        capturedCb = cb as (payload: unknown) => Promise<void>
        return () => undefined
      })

      await gateway.start()
      await capturedCb!({ type: 'evolution_result', id: 'ev-1', status: 'approved' })

      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('ev-1'))
    })

    it('formats evolution_proposed event and broadcasts it', async () => {
      const adapter = makeMockAdapter('log')
      const gateway = new Gateway([adapter])

      let capturedCb: ((payload: unknown) => Promise<void>) | null = null
      vi.mocked(subscribe).mockImplementationOnce(async (_ch, cb) => {
        capturedCb = cb as (payload: unknown) => Promise<void>
        return () => undefined
      })

      await gateway.start()
      await capturedCb!({ type: 'evolution_proposed', id: 'ev-2', diff: 'diff --git ...' })

      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('/approve ev-2'))
    })

    it('formats mcp_removed event and broadcasts it', async () => {
      const adapter = makeMockAdapter('log')
      const gateway = new Gateway([adapter])

      let capturedCb: ((payload: unknown) => Promise<void>) | null = null
      vi.mocked(subscribe).mockImplementationOnce(async (_ch, cb) => {
        capturedCb = cb as (payload: unknown) => Promise<void>
        return () => undefined
      })

      await gateway.start()
      await capturedCb!({ type: 'mcp_removed', name: 'old-db' })

      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('old-db'))
    })

    it('formats job_complete with error field', async () => {
      const adapter = makeMockAdapter('log')
      const gateway = new Gateway([adapter])

      let capturedCb: ((payload: unknown) => Promise<void>) | null = null
      vi.mocked(subscribe).mockImplementationOnce(async (_ch, cb) => {
        capturedCb = cb as (payload: unknown) => Promise<void>
        return () => undefined
      })

      await gateway.start()
      await capturedCb!({ type: 'job_complete', jobId: 'j-err', status: 'failed', error: 'timeout' })

      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('timeout'))
    })

    it('continues starting other adapters if one throws', async () => {
      const a1 = makeMockAdapter('a1')
      const a2 = makeMockAdapter('a2')
      a1.start.mockRejectedValue(new Error('start failed'))
      const gateway = new Gateway([a1, a2])

      await expect(gateway.start()).resolves.toBeUndefined()
      expect(a2.start).toHaveBeenCalled()
    })

    it('formats mcp_registered with no tools (defaults to "none")', async () => {
      const adapter = makeMockAdapter('log')
      const gateway = new Gateway([adapter])

      let capturedCb: ((payload: unknown) => Promise<void>) | null = null
      vi.mocked(subscribe).mockImplementationOnce(async (_ch, cb) => {
        capturedCb = cb as (payload: unknown) => Promise<void>
        return () => undefined
      })

      await gateway.start()
      await capturedCb!({ type: 'mcp_registered', name: 'no-tools-mcp', status: 'partial' })

      expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('Tools: none'))
    })
  })

  describe('stop', () => {
    it('calls stop on all adapters', async () => {
      const a1 = makeMockAdapter('a1')
      const gateway = new Gateway([a1])

      await gateway.start()
      await gateway.stop()

      expect(a1.stop).toHaveBeenCalled()
    })

    it('continues stopping other adapters if one throws', async () => {
      const a1 = makeMockAdapter('a1')
      const a2 = makeMockAdapter('a2')
      a1.stop.mockRejectedValue(new Error('stop failed'))
      const gateway = new Gateway([a1, a2])

      await gateway.start()
      await expect(gateway.stop()).resolves.toBeUndefined()
      expect(a2.stop).toHaveBeenCalled()
    })
  })
})
