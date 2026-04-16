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

import { log } from '@ouroboros/core'
import { LogAdapter } from '../adapters/log.js'
import { SlackAdapter } from '../adapters/slack.js'
import { WebhookAdapter } from '../adapters/webhook.js'
import { TelegramAdapter } from '../adapters/telegram.js'

const mockLog = vi.mocked(log)

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

    it('start() calls core log', async () => {
      const adapter = new SlackAdapter('xoxb-token', 'C1234')
      await adapter.start()
      expect(mockLog).toHaveBeenCalledWith('gateway:slack', expect.stringContaining('started'))
    })

    it('stop() resolves without error', async () => {
      const adapter = new SlackAdapter('token', 'chan')
      await expect(adapter.stop()).resolves.toBeUndefined()
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
