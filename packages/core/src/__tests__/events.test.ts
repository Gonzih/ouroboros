import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Hoist mock state so it's available inside vi.mock() factories
const { mockEnd, mockUnsafe, mockCatch, mockListen, mockConn, mockPostgres, mockDb } = vi.hoisted(() => {
  const mockEnd = vi.fn().mockResolvedValue(undefined)
  const mockCatch = vi.fn()
  const mockUnsafe = vi.fn().mockReturnValue({ catch: mockCatch })
  const mockListen = vi.fn()
  const mockConn = { listen: mockListen, unsafe: mockUnsafe, end: mockEnd }
  const mockPostgres = vi.fn().mockReturnValue(mockConn)
  const mockDb = vi.fn()
  return { mockEnd, mockUnsafe, mockCatch, mockListen, mockConn, mockPostgres, mockDb }
})

vi.mock('../db.js', () => ({
  getDb: () => mockDb,
}))

vi.mock('postgres', () => ({
  default: mockPostgres,
}))

import { publish, subscribe } from '../events.js'

describe('events', () => {
  let capturedChannel: string | null = null
  let capturedListenHandler: ((data: string) => Promise<void>) | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    capturedChannel = null
    capturedListenHandler = null

    mockPostgres.mockReturnValue(mockConn)
    mockEnd.mockResolvedValue(undefined)
    mockUnsafe.mockReturnValue({ catch: mockCatch })
    mockListen.mockImplementation((ch: string, handler: (data: string) => Promise<void>) => {
      capturedChannel = ch
      capturedListenHandler = handler
      return Promise.resolve()
    })
    process.env['DATABASE_URL'] = 'postgres://localhost/test'
  })

  afterEach(() => {
    delete process.env['DATABASE_URL']
  })

  describe('publish', () => {
    it('calls db to emit pg_notify', async () => {
      mockDb.mockResolvedValueOnce([])
      await publish('ouro_notify', { type: 'mcp_registered', name: 'my-db' })
      expect(mockDb).toHaveBeenCalledOnce()
    })

    it('resolves without throwing on db success', async () => {
      mockDb.mockResolvedValueOnce([])
      await expect(publish('chan', { x: 1 })).resolves.toBeUndefined()
    })

    it('propagates db errors', async () => {
      mockDb.mockRejectedValueOnce(new Error('connection refused'))
      await expect(publish('chan', {})).rejects.toThrow('connection refused')
    })
  })

  describe('subscribe', () => {
    it('creates a dedicated postgres connection with DATABASE_URL', async () => {
      await subscribe('ouro_notify', vi.fn())
      expect(mockPostgres).toHaveBeenCalledWith('postgres://localhost/test', { max: 1 })
    })

    it('listens on the correct channel', async () => {
      await subscribe('my-channel', vi.fn())
      expect(capturedChannel).toBe('my-channel')
    })

    it('calls callback with parsed JSON payload', async () => {
      const cb = vi.fn().mockResolvedValue(undefined)
      await subscribe('ouro_notify', cb)
      await capturedListenHandler!(JSON.stringify({ type: 'test', id: 42 }))
      expect(cb).toHaveBeenCalledWith({ type: 'test', id: 42 })
    })

    it('calls callback with raw string when payload is not valid JSON', async () => {
      const cb = vi.fn().mockResolvedValue(undefined)
      await subscribe('ouro_notify', cb)
      await capturedListenHandler!('not-json')
      expect(cb).toHaveBeenCalledWith('not-json')
    })

    it('swallows callback errors — event bus must not crash', async () => {
      const cb = vi.fn().mockRejectedValue(new Error('handler boom'))
      await subscribe('ouro_notify', cb)
      await expect(capturedListenHandler!(JSON.stringify({ x: 1 }))).resolves.toBeUndefined()
    })

    it('sets up reconnect watchdog via unsafe query', async () => {
      await subscribe('ouro_notify', vi.fn())
      expect(mockUnsafe).toHaveBeenCalledWith('SELECT 1')
      expect(mockCatch).toHaveBeenCalledOnce()
    })

    it('returns an unsubscribe function that ends the connection', async () => {
      const unsub = await subscribe('ouro_notify', vi.fn())
      await unsub()
      expect(mockEnd).toHaveBeenCalledOnce()
    })

    it('calling unsubscribe twice does not call end twice', async () => {
      const unsub = await subscribe('ouro_notify', vi.fn())
      await unsub()
      await unsub()
      expect(mockEnd).toHaveBeenCalledOnce()
    })
  })
})
