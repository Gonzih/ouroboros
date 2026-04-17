import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@ouroboros/core', () => ({
  log: vi.fn().mockResolvedValue(undefined),
  getDb: vi.fn(),
  subscribe: vi.fn(),
}))

vi.mock('node-telegram-bot-api', () => ({
  default: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue({}),
    stopPolling: vi.fn().mockResolvedValue(undefined),
  }))
}))

import { log, getDb } from '@ouroboros/core'
import { LogAdapter } from '../adapters/log.js'
import { SlackAdapter } from '../adapters/slack.js'
import { WebhookAdapter } from '../adapters/webhook.js'
import { TelegramAdapter } from '../adapters/telegram.js'
import crypto from 'node:crypto'

const mockLog = vi.mocked(log)
const mockGetDb = vi.mocked(getDb)

// Build a valid Slack HMAC-SHA256 signature for testing
function slackSignature(secret: string, timestamp: string, body: string): string {
  const baseString = `v0:${timestamp}:${body}`
  return 'v0=' + crypto.createHmac('sha256', secret).update(baseString).digest('hex')
}

describe('ChannelAdapter implementations', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('LogAdapter', () => {
    it('has correct name', () => {
      const adapter = new LogAdapter()
      expect(adapter.name).toBe('log')
    })

    it('send() calls core log', async () => {
      const adapter = new LogAdapter()
      await adapter.send('hello world')
      expect(mockLog).toHaveBeenCalledWith('gateway:log', 'hello world')
    })

    it('start() calls core log', async () => {
      const adapter = new LogAdapter()
      await adapter.start()
      expect(mockLog).toHaveBeenCalledWith('gateway:log', 'log adapter started')
    })

    it('stop() resolves without error', async () => {
      const adapter = new LogAdapter()
      await expect(adapter.stop()).resolves.toBeUndefined()
    })
  })

  describe('SlackAdapter', () => {
    it('has correct name', () => {
      const adapter = new SlackAdapter('xoxb-token', 'C1234')
      expect(adapter.name).toBe('slack')
    })

    it('start() logs outbound-only when no signing secret', async () => {
      const adapter = new SlackAdapter('xoxb-token', 'C1234')
      await adapter.start()
      expect(mockLog).toHaveBeenCalledWith('gateway:slack', 'slack adapter started (outbound only)')
    })

    it('start() logs inbound+outbound when signing secret provided', async () => {
      const adapter = new SlackAdapter('xoxb-token', 'C1234', 'secret')
      await adapter.start()
      expect(mockLog).toHaveBeenCalledWith('gateway:slack', 'slack adapter started (inbound + outbound)')
    })

    it('stop() resolves without error', async () => {
      const adapter = new SlackAdapter('token', 'chan')
      await expect(adapter.stop()).resolves.toBeUndefined()
    })

    describe('handleEvent()', () => {
      const secret = 'test-signing-secret'
      const timestamp = String(Math.floor(Date.now() / 1000))

      it('returns null when no signing secret configured', async () => {
        const adapter = new SlackAdapter('token', 'chan')
        const result = await adapter.handleEvent('{}', timestamp, 'v0=anything')
        expect(result).toBeNull()
      })

      it('returns null on invalid signature', async () => {
        const adapter = new SlackAdapter('token', 'chan', secret)
        const result = await adapter.handleEvent('{}', timestamp, 'v0=badsig')
        expect(result).toBeNull()
      })

      it('returns null on replayed timestamp (>5min old)', async () => {
        const adapter = new SlackAdapter('token', 'chan', secret)
        const oldTs = String(Math.floor(Date.now() / 1000) - 400)
        const body = '{}'
        const sig = slackSignature(secret, oldTs, body)
        const result = await adapter.handleEvent(body, oldTs, sig)
        expect(result).toBeNull()
      })

      it('responds to URL verification challenge', async () => {
        const adapter = new SlackAdapter('token', 'chan', secret)
        const body = JSON.stringify({ type: 'url_verification', challenge: 'abc123' })
        const sig = slackSignature(secret, timestamp, body)
        const result = await adapter.handleEvent(body, timestamp, sig)
        expect(result).toEqual({ challenge: 'abc123' })
      })

      it('handles /approve command from message event', async () => {
        const mockDb = vi.fn().mockResolvedValue([{ id: 'fb-1' }])
        mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)

        const adapter = new SlackAdapter('token', 'chan', secret)
        // Mock send so we don't need HTTPS
        vi.spyOn(adapter, 'send').mockResolvedValue(undefined)

        const body = JSON.stringify({
          type: 'event_callback',
          event: { type: 'message', text: '/approve fb-1' },
        })
        const sig = slackSignature(secret, timestamp, body)
        const result = await adapter.handleEvent(body, timestamp, sig)

        expect(result).toEqual({})
        expect(mockDb).toHaveBeenCalled()
        expect(adapter.send).toHaveBeenCalledWith('Evolution fb-1 approved.')
      })

      it('handles /reject command from message event', async () => {
        const mockDb = vi.fn().mockResolvedValue([{ id: 'fb-2' }])
        mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)

        const adapter = new SlackAdapter('token', 'chan', secret)
        vi.spyOn(adapter, 'send').mockResolvedValue(undefined)

        const body = JSON.stringify({
          type: 'event_callback',
          event: { type: 'message', text: '/reject fb-2' },
        })
        const sig = slackSignature(secret, timestamp, body)
        const result = await adapter.handleEvent(body, timestamp, sig)

        expect(result).toEqual({})
        expect(mockDb).toHaveBeenCalled()
        expect(adapter.send).toHaveBeenCalledWith('Evolution fb-2 rejected.')
      })

      it('ignores bot messages (subtype present)', async () => {
        const adapter = new SlackAdapter('token', 'chan', secret)
        vi.spyOn(adapter, 'send').mockResolvedValue(undefined)

        const body = JSON.stringify({
          type: 'event_callback',
          event: { type: 'message', subtype: 'bot_message', text: '/approve fb-1' },
        })
        const sig = slackSignature(secret, timestamp, body)
        const result = await adapter.handleEvent(body, timestamp, sig)

        expect(result).toEqual({})
        expect(adapter.send).not.toHaveBeenCalled()
      })

      it('returns {} for unrecognised event types', async () => {
        const adapter = new SlackAdapter('token', 'chan', secret)
        const body = JSON.stringify({ type: 'event_callback', event: { type: 'reaction_added' } })
        const sig = slackSignature(secret, timestamp, body)
        const result = await adapter.handleEvent(body, timestamp, sig)
        expect(result).toEqual({})
      })
    })
  })

  describe('WebhookAdapter', () => {
    it('has correct name', () => {
      const adapter = new WebhookAdapter('https://example.com/hook')
      expect(adapter.name).toBe('webhook')
    })

    it('start() calls core log', async () => {
      const adapter = new WebhookAdapter('https://example.com/hook')
      await adapter.start()
      expect(mockLog).toHaveBeenCalledWith('gateway:webhook', expect.stringContaining('https://example.com/hook'))
    })

    it('stop() resolves without error', async () => {
      const adapter = new WebhookAdapter('https://example.com/hook')
      await expect(adapter.stop()).resolves.toBeUndefined()
    })
  })

  describe('TelegramAdapter', () => {
    it('has correct name', () => {
      const adapter = new TelegramAdapter('bot-token', '-100123')
      expect(adapter.name).toBe('telegram')
    })

    it('stop() before start() resolves without error', async () => {
      const adapter = new TelegramAdapter('bot-token', '-100123')
      await expect(adapter.stop()).resolves.toBeUndefined()
    })
  })
})
