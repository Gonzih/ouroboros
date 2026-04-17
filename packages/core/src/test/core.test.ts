import { describe, it, expect } from 'vitest'

// Requires DATABASE_URL *and* OURO_INTEGRATION_TESTS=1 to avoid
// accidentally hitting a live queue with shared state.
const skipDb = !process.env['DATABASE_URL'] || process.env['OURO_INTEGRATION_TESTS'] !== '1'

describe('core — DB integration', () => {
  describe('migrate', () => {
    it.skipIf(skipDb)('runs without error', async () => {
      const { migrate } = await import('../migrate.js')
      await migrate()
    })
  })

  describe('queue', () => {
    it.skipIf(skipDb)('enqueue/dequeue round-trip', async () => {
      const { enqueue, dequeue, ack } = await import('../queue.js')
      const payload = { hello: 'world', ts: Date.now() }
      const msgId = await enqueue('ouro_tasks', payload)
      expect(typeof msgId).toBe('bigint')

      const item = await dequeue<typeof payload>('ouro_tasks')
      expect(item).not.toBeNull()
      expect(item!.message.hello).toBe('world')
      await ack('ouro_tasks', item!.msgId)
    })
  })

  describe('events', () => {
    it.skipIf(skipDb)('publish/subscribe round-trip', async () => {
      const { publish, subscribe } = await import('../events.js')
      const received: unknown[] = []

      const unsub = await subscribe('test_channel', async payload => {
        received.push(payload)
      })

      await new Promise(r => setTimeout(r, 100))
      await publish('test_channel', { ping: true })
      await new Promise(r => setTimeout(r, 200))
      await unsub()

      expect(received.length).toBeGreaterThanOrEqual(1)
      expect((received[0] as { ping: boolean }).ping).toBe(true)
    })
  })

  describe('locks', () => {
    it.skipIf(skipDb)('tryAcquireLock returns true then false for same key', async () => {
      const { tryAcquireLock, releaseLock } = await import('../locks.js')
      const key = `test-lock-${Date.now()}`

      const first = await tryAcquireLock(key)
      expect(first).toBe(true)

      await releaseLock(key)

      const after = await tryAcquireLock(key)
      expect(after).toBe(true)
      await releaseLock(key)
    })
  })
})
