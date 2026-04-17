import { describe, it, expect, vi, beforeEach } from 'vitest'
import http from 'node:http'
import crypto from 'node:crypto'
import type { AddressInfo } from 'node:net'

vi.mock('@ouroboros/core', () => ({
  log: vi.fn().mockResolvedValue(undefined),
  getDb: vi.fn(),
  subscribe: vi.fn(),
  enqueue: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('node-telegram-bot-api', () => ({
  default: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue({}),
    stopPolling: vi.fn().mockResolvedValue(undefined),
  }))
}))

import { log, getDb, enqueue } from '@ouroboros/core'
import { LogAdapter } from '../adapters/log.js'
import { SlackAdapter } from '../adapters/slack.js'
import { DiscordAdapter } from '../adapters/discord.js'
import { WebhookAdapter } from '../adapters/webhook.js'
import { TelegramAdapter } from '../adapters/telegram.js'
import TelegramBot from 'node-telegram-bot-api'

const mockLog = vi.mocked(log)
const mockGetDb = vi.mocked(getDb)
const mockEnqueue = vi.mocked(enqueue)

// Drain the microtask + macrotask queue so void-async handlers complete.
const flush = () => new Promise<void>(r => setTimeout(r, 0))

// Configure the TelegramBot mock to capture event callbacks and expose send/stop stubs.
function makeBot() {
  const cbs: Record<string, (...args: unknown[]) => unknown> = {}
  const sendMessage = vi.fn().mockResolvedValue({})
  const stopPolling = vi.fn().mockResolvedValue(undefined)
  vi.mocked(TelegramBot as unknown as (...a: unknown[]) => unknown).mockImplementationOnce(() => ({
    on: vi.fn().mockImplementation((event: string, cb: (...args: unknown[]) => unknown) => {
      cbs[event] = cb
    }),
    sendMessage,
    stopPolling,
  }))
  return { cbs, sendMessage, stopPolling }
}

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

      it('returns null when payload is not an object', async () => {
        const adapter = new SlackAdapter('token', 'chan', secret)
        const body = '"just a string"'
        const sig = slackSignature(secret, timestamp, body)
        const result = await adapter.handleEvent(body, timestamp, sig)
        expect(result).toBeNull()
      })

      it('returns null when payload is invalid JSON', async () => {
        const adapter = new SlackAdapter('token', 'chan', secret)
        const body = 'not-json'
        const sig = slackSignature(secret, timestamp, body)
        const result = await adapter.handleEvent(body, timestamp, sig)
        expect(result).toBeNull()
      })

      it('handles /approve not found via event_callback', async () => {
        const mockDb = vi.fn().mockResolvedValue([])
        mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
        const adapter = new SlackAdapter('token', 'chan', secret)
        vi.spyOn(adapter, 'send').mockResolvedValue(undefined)
        const body = JSON.stringify({
          type: 'event_callback',
          event: { type: 'message', text: '/approve fb-missing' },
        })
        const sig = slackSignature(secret, timestamp, body)
        await adapter.handleEvent(body, timestamp, sig)
        expect(adapter.send).toHaveBeenCalledWith('No feedback found with id fb-missing')
      })

      it('handles /reject not found via event_callback', async () => {
        const mockDb = vi.fn().mockResolvedValue([])
        mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
        const adapter = new SlackAdapter('token', 'chan', secret)
        vi.spyOn(adapter, 'send').mockResolvedValue(undefined)
        const body = JSON.stringify({
          type: 'event_callback',
          event: { type: 'message', text: '/reject fb-missing' },
        })
        const sig = slackSignature(secret, timestamp, body)
        await adapter.handleEvent(body, timestamp, sig)
        expect(adapter.send).toHaveBeenCalledWith('No feedback found with id fb-missing')
      })

      it('handles /approve db error gracefully', async () => {
        const mockDb = vi.fn().mockRejectedValue(new Error('db fail'))
        mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
        const adapter = new SlackAdapter('token', 'chan', secret)
        vi.spyOn(adapter, 'send').mockResolvedValue(undefined)
        const body = JSON.stringify({
          type: 'event_callback',
          event: { type: 'message', text: '/approve fb-1' },
        })
        const sig = slackSignature(secret, timestamp, body)
        await adapter.handleEvent(body, timestamp, sig)
        expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('Error approving'))
      })

      it('handles /reject db error gracefully', async () => {
        const mockDb = vi.fn().mockRejectedValue(new Error('db fail'))
        mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
        const adapter = new SlackAdapter('token', 'chan', secret)
        vi.spyOn(adapter, 'send').mockResolvedValue(undefined)
        const body = JSON.stringify({
          type: 'event_callback',
          event: { type: 'message', text: '/reject fb-2' },
        })
        const sig = slackSignature(secret, timestamp, body)
        await adapter.handleEvent(body, timestamp, sig)
        expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('Error rejecting'))
      })

      it('handles /logs command and sends recent logs', async () => {
        const mockDb = vi.fn().mockResolvedValue([
          { source: 'worker', message: 'task completed', ts: new Date() },
        ])
        mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
        const adapter = new SlackAdapter('token', 'chan', secret)
        vi.spyOn(adapter, 'send').mockResolvedValue(undefined)
        const body = JSON.stringify({
          type: 'event_callback',
          event: { type: 'message', text: '/logs' },
        })
        const sig = slackSignature(secret, timestamp, body)
        await adapter.handleEvent(body, timestamp, sig)
        expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('worker'))
      })

      it('handles /feedback command and queues feedback', async () => {
        const adapter = new SlackAdapter('token', 'chan', secret)
        vi.spyOn(adapter, 'send').mockResolvedValue(undefined)
        const body = JSON.stringify({
          type: 'event_callback',
          event: { type: 'message', text: '/feedback add retry logic' },
        })
        const sig = slackSignature(secret, timestamp, body)
        await adapter.handleEvent(body, timestamp, sig)
        expect(mockEnqueue).toHaveBeenCalledWith('ouro_feedback', expect.objectContaining({
          source: 'slack',
          text: 'add retry logic',
          status: 'pending',
        }))
        expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('Feedback queued'))
      })

      it('handles /task command and queues task', async () => {
        const mockDb = vi.fn().mockResolvedValue([])
        mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
        const adapter = new SlackAdapter('token', 'chan', secret)
        vi.spyOn(adapter, 'send').mockResolvedValue(undefined)
        const body = JSON.stringify({
          type: 'event_callback',
          event: { type: 'message', text: '/task git https://github.com/x/y Add tests' },
        })
        const sig = slackSignature(secret, timestamp, body)
        await adapter.handleEvent(body, timestamp, sig)
        expect(mockEnqueue).toHaveBeenCalledWith('ouro_tasks', expect.objectContaining({
          backend: 'git',
          target: 'https://github.com/x/y',
          instructions: 'Add tests',
        }))
        expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('Task queued'))
      })

      it('handles /status command and shows job and MCP counts', async () => {
        const mockDb = vi.fn()
          .mockResolvedValueOnce([{ running: '2', pending: '1', completed: '5', failed: '0' }])
          .mockResolvedValueOnce([{ count: '3' }])
        mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
        const adapter = new SlackAdapter('token', 'chan', secret)
        vi.spyOn(adapter, 'send').mockResolvedValue(undefined)
        const body = JSON.stringify({
          type: 'event_callback',
          event: { type: 'message', text: '/status' },
        })
        const sig = slackSignature(secret, timestamp, body)
        await adapter.handleEvent(body, timestamp, sig)
        expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('running: 2'))
      })

      it('handles /jobs command and shows recent jobs', async () => {
        const mockDb = vi.fn().mockResolvedValue([
          { id: 'job-1', description: 'test job', status: 'running', created_at: new Date() },
        ])
        mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
        const adapter = new SlackAdapter('token', 'chan', secret)
        vi.spyOn(adapter, 'send').mockResolvedValue(undefined)
        const body = JSON.stringify({
          type: 'event_callback',
          event: { type: 'message', text: '/jobs' },
        })
        const sig = slackSignature(secret, timestamp, body)
        await adapter.handleEvent(body, timestamp, sig)
        expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('job-1'))
      })

      it('handles /mcp command and lists registered MCPs', async () => {
        const mockDb = vi.fn().mockResolvedValue([
          { name: 'pg-mcp', status: 'operational', tools_found: ['query', 'insert'] },
        ])
        mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
        const adapter = new SlackAdapter('token', 'chan', secret)
        vi.spyOn(adapter, 'send').mockResolvedValue(undefined)
        const body = JSON.stringify({
          type: 'event_callback',
          event: { type: 'message', text: '/mcp' },
        })
        const sig = slackSignature(secret, timestamp, body)
        await adapter.handleEvent(body, timestamp, sig)
        expect(adapter.send).toHaveBeenCalledWith(expect.stringContaining('pg-mcp'))
      })

      it('returns {} when signature buffers have different lengths', async () => {
        const adapter = new SlackAdapter('token', 'chan', secret)
        // A valid-format sig but intentionally short
        const result = await adapter.handleEvent('{}', timestamp, 'v0=short')
        expect(result).toBeNull()
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

    it('send() POSTs JSON payload to HTTP endpoint', async () => {
      let capturedBody = ''
      const server = http.createServer((req, res) => {
        let body = ''
        req.on('data', (c: Buffer) => { body += c.toString() })
        req.on('end', () => { capturedBody = body; res.writeHead(200); res.end() })
      })
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const { port } = server.address() as AddressInfo

      const adapter = new WebhookAdapter(`http://127.0.0.1:${port}/hook`)
      await adapter.send('hello webhook')
      await new Promise<void>(resolve => server.close(() => resolve()))

      const parsed = JSON.parse(capturedBody) as { message: string; timestamp: string }
      expect(parsed.message).toBe('hello webhook')
      expect(parsed.timestamp).toBeDefined()
    })

    it('send() logs error when server returns non-2xx', async () => {
      const server = http.createServer((_req, res) => { res.writeHead(500); res.end() })
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const { port } = server.address() as AddressInfo

      const adapter = new WebhookAdapter(`http://127.0.0.1:${port}/hook`)
      await adapter.send('fail test')
      await new Promise<void>(resolve => server.close(() => resolve()))

      expect(mockLog).toHaveBeenCalledWith('gateway:webhook', expect.stringContaining('send failed'))
    })

    it('send() logs error on connection failure', async () => {
      const adapter = new WebhookAdapter('http://127.0.0.1:19998/hook')
      await adapter.send('no server')
      expect(mockLog).toHaveBeenCalledWith('gateway:webhook', expect.stringContaining('send failed'))
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

    it('start() creates bot, registers message and polling_error handlers', async () => {
      const { cbs } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      expect(cbs['message']).toBeDefined()
      expect(cbs['polling_error']).toBeDefined()
      expect(mockLog).toHaveBeenCalledWith('gateway:telegram', 'telegram adapter started (polling)')
    })

    it('stop() after start() calls stopPolling', async () => {
      const { stopPolling } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      await adapter.stop()
      expect(stopPolling).toHaveBeenCalled()
    })

    it('send() sends message when bot is active', async () => {
      const { sendMessage } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      await adapter.send('hello telegram')
      expect(sendMessage).toHaveBeenCalledWith('-100', 'hello telegram')
    })

    it('send() logs error when sendMessage throws', async () => {
      const { sendMessage } = makeBot()
      sendMessage.mockRejectedValueOnce(new Error('rate limited'))
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      await adapter.send('fail msg')
      expect(mockLog).toHaveBeenCalledWith('gateway:telegram', expect.stringContaining('send failed'))
    })

    it('polling_error handler logs the error', async () => {
      const { cbs } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      await cbs['polling_error']!(new Error('network fail'))
      await flush()
      expect(mockLog).toHaveBeenCalledWith('gateway:telegram', expect.stringContaining('polling error'))
    })

    it('ignores unknown text messages silently', async () => {
      const { cbs, sendMessage } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      cbs['message']!({ text: 'hello there' })
      await flush()
      expect(sendMessage).not.toHaveBeenCalled()
    })

    it('handles message with undefined text', async () => {
      const { cbs, sendMessage } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      cbs['message']!({ text: undefined })
      await flush()
      expect(sendMessage).not.toHaveBeenCalled()
    })

    it('/approve success', async () => {
      const mockDb = vi.fn().mockResolvedValue([{ id: 'fb-1' }])
      mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
      const { cbs, sendMessage } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      cbs['message']!({ text: '/approve fb-1' })
      await flush()
      expect(sendMessage).toHaveBeenCalledWith('-100', 'Evolution fb-1 approved.')
    })

    it('/approve not found', async () => {
      const mockDb = vi.fn().mockResolvedValue([])
      mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
      const { cbs, sendMessage } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      cbs['message']!({ text: '/approve fb-missing' })
      await flush()
      expect(sendMessage).toHaveBeenCalledWith('-100', 'No feedback found with id fb-missing')
    })

    it('/approve db error sends error message', async () => {
      const mockDb = vi.fn().mockRejectedValue(new Error('db fail'))
      mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
      const { cbs, sendMessage } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      cbs['message']!({ text: '/approve fb-1' })
      await flush()
      expect(mockLog).toHaveBeenCalledWith('gateway:telegram', expect.stringContaining('approve error'))
      expect(sendMessage).toHaveBeenCalledWith('-100', expect.stringContaining('Error approving'))
    })

    it('/reject success', async () => {
      const mockDb = vi.fn().mockResolvedValue([{ id: 'fb-2' }])
      mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
      const { cbs, sendMessage } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      cbs['message']!({ text: '/reject fb-2' })
      await flush()
      expect(sendMessage).toHaveBeenCalledWith('-100', 'Evolution fb-2 rejected.')
    })

    it('/reject not found', async () => {
      const mockDb = vi.fn().mockResolvedValue([])
      mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
      const { cbs, sendMessage } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      cbs['message']!({ text: '/reject fb-missing' })
      await flush()
      expect(sendMessage).toHaveBeenCalledWith('-100', 'No feedback found with id fb-missing')
    })

    it('/reject db error sends error message', async () => {
      const mockDb = vi.fn().mockRejectedValue(new Error('db fail'))
      mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
      const { cbs, sendMessage } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      cbs['message']!({ text: '/reject fb-2' })
      await flush()
      expect(mockLog).toHaveBeenCalledWith('gateway:telegram', expect.stringContaining('reject error'))
      expect(sendMessage).toHaveBeenCalledWith('-100', expect.stringContaining('Error rejecting'))
    })

    it('/status shows job and MCP counts', async () => {
      const mockDb = vi.fn()
        .mockResolvedValueOnce([{ running: '2', pending: '1', completed: '5', failed: '0' }])
        .mockResolvedValueOnce([{ count: '3' }])
      mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
      const { cbs, sendMessage } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      cbs['message']!({ text: '/status' })
      await flush()
      expect(sendMessage).toHaveBeenCalledWith('-100', expect.stringContaining('running: 2'))
    })

    it('/status db error sends error message', async () => {
      const mockDb = vi.fn().mockRejectedValue(new Error('db fail'))
      mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
      const { cbs, sendMessage } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      cbs['message']!({ text: '/status' })
      await flush()
      expect(sendMessage).toHaveBeenCalledWith('-100', expect.stringContaining('Error fetching status'))
    })

    it('/jobs shows recent jobs', async () => {
      const mockDb = vi.fn().mockResolvedValue([
        { id: 'job-1', description: 'test job', status: 'running', created_at: new Date() },
      ])
      mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
      const { cbs, sendMessage } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      cbs['message']!({ text: '/jobs' })
      await flush()
      expect(sendMessage).toHaveBeenCalledWith('-100', expect.stringContaining('job-1'))
    })

    it('/jobs shows empty message when no jobs', async () => {
      const mockDb = vi.fn().mockResolvedValue([])
      mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
      const { cbs, sendMessage } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      cbs['message']!({ text: '/jobs' })
      await flush()
      expect(sendMessage).toHaveBeenCalledWith('-100', 'No jobs found.')
    })

    it('/jobs db error sends error message', async () => {
      const mockDb = vi.fn().mockRejectedValue(new Error('db fail'))
      mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
      const { cbs, sendMessage } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      cbs['message']!({ text: '/jobs' })
      await flush()
      expect(sendMessage).toHaveBeenCalledWith('-100', expect.stringContaining('Error fetching jobs'))
    })

    it('/mcp lists registered MCPs with tools', async () => {
      const mockDb = vi.fn().mockResolvedValue([
        { name: 'pg-mcp', status: 'operational', tools_found: ['query', 'insert'] },
      ])
      mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
      const { cbs, sendMessage } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      cbs['message']!({ text: '/mcp' })
      await flush()
      expect(sendMessage).toHaveBeenCalledWith('-100', expect.stringContaining('pg-mcp'))
    })

    it('/mcp shows empty message when none registered', async () => {
      const mockDb = vi.fn().mockResolvedValue([])
      mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
      const { cbs, sendMessage } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      cbs['message']!({ text: '/mcp' })
      await flush()
      expect(sendMessage).toHaveBeenCalledWith('-100', 'No MCPs registered.')
    })

    it('/mcp db error sends error message', async () => {
      const mockDb = vi.fn().mockRejectedValue(new Error('db fail'))
      mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
      const { cbs, sendMessage } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      cbs['message']!({ text: '/mcp' })
      await flush()
      expect(sendMessage).toHaveBeenCalledWith('-100', expect.stringContaining('Error fetching MCPs'))
    })

    it('/logs shows recent log entries', async () => {
      const mockDb = vi.fn().mockResolvedValue([
        { source: 'meta-agent', message: 'coordinator started', ts: new Date() },
      ])
      mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
      const { cbs, sendMessage } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      cbs['message']!({ text: '/logs' })
      await flush()
      expect(sendMessage).toHaveBeenCalledWith('-100', expect.stringContaining('meta-agent'))
    })

    it('/logs shows empty message when no logs', async () => {
      const mockDb = vi.fn().mockResolvedValue([])
      mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
      const { cbs, sendMessage } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      cbs['message']!({ text: '/logs' })
      await flush()
      expect(sendMessage).toHaveBeenCalledWith('-100', 'No logs found.')
    })

    it('/feedback queues feedback and confirms', async () => {
      mockEnqueue.mockResolvedValue(undefined)
      const { cbs, sendMessage } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      cbs['message']!({ text: '/feedback improve error handling' })
      await flush()
      expect(mockEnqueue).toHaveBeenCalledWith('ouro_feedback', expect.objectContaining({
        source: 'telegram',
        text: 'improve error handling',
        status: 'pending',
      }))
      expect(sendMessage).toHaveBeenCalledWith('-100', expect.stringContaining('Feedback queued'))
    })

    it('/task full form queues task and confirms', async () => {
      const mockDb = vi.fn().mockResolvedValue([])
      mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
      const { cbs, sendMessage } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      cbs['message']!({ text: '/task git https://github.com/acme/repo Build a test suite' })
      await flush()
      expect(mockEnqueue).toHaveBeenCalledWith('ouro_tasks', expect.objectContaining({
        backend: 'git',
        target: 'https://github.com/acme/repo',
        instructions: 'Build a test suite',
      }))
      expect(sendMessage).toHaveBeenCalledWith('-100', expect.stringContaining('Task queued'))
    })

    it('/task short form uses OURO_REPO_ROOT', async () => {
      process.env['OURO_REPO_ROOT'] = '/tmp/repo'
      const mockDb = vi.fn().mockResolvedValue([])
      mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
      const { cbs, sendMessage } = makeBot()
      const adapter = new TelegramAdapter('tok', '-100')
      await adapter.start()
      cbs['message']!({ text: '/task Write unit tests' })
      await flush()
      expect(mockEnqueue).toHaveBeenCalledWith('ouro_tasks', expect.objectContaining({
        backend: 'git',
        target: '/tmp/repo',
        instructions: 'Write unit tests',
      }))
      expect(sendMessage).toHaveBeenCalledWith('-100', expect.stringContaining('Task queued'))
      delete process.env['OURO_REPO_ROOT']
    })
  })

  describe('DiscordAdapter', () => {
    // Generate a real Ed25519 key pair for signature tests — no mocking needed
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    const rawPubKeyHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex')

    function discordSign(timestamp: string, body: string): string {
      return crypto.sign(null, Buffer.from(timestamp + body), privateKey).toString('hex')
    }

    it('has correct name', () => {
      const adapter = new DiscordAdapter('token', '123456789')
      expect(adapter.name).toBe('discord')
    })

    it('start() logs outbound-only when no public key', async () => {
      const adapter = new DiscordAdapter('token', '123456789')
      await adapter.start()
      expect(mockLog).toHaveBeenCalledWith('gateway:discord', 'discord adapter started (outbound only)')
    })

    it('start() logs inbound+outbound when public key provided', async () => {
      const adapter = new DiscordAdapter('token', '123456789', rawPubKeyHex)
      await adapter.start()
      expect(mockLog).toHaveBeenCalledWith('gateway:discord', 'discord adapter started (inbound + outbound)')
    })

    it('stop() resolves without error', async () => {
      const adapter = new DiscordAdapter('token', 'chan')
      await expect(adapter.stop()).resolves.toBeUndefined()
    })

    describe('handleInteraction()', () => {
      it('returns null when no public key configured', async () => {
        const adapter = new DiscordAdapter('token', 'chan')
        const result = await adapter.handleInteraction('{}', 'sig', 'ts')
        expect(result).toBeNull()
      })

      it('returns null on invalid signature', async () => {
        const adapter = new DiscordAdapter('token', 'chan', rawPubKeyHex)
        const result = await adapter.handleInteraction('{}', 'badsig00'.repeat(16), 'ts')
        expect(result).toBeNull()
      })

      it('responds to PING with type 1', async () => {
        const adapter = new DiscordAdapter('token', 'chan', rawPubKeyHex)
        const body = JSON.stringify({ type: 1 })
        const ts = String(Date.now())
        const result = await adapter.handleInteraction(body, discordSign(ts, body), ts)
        expect(result).toEqual({ type: 1 })
      })

      it('handles /approve command and returns interaction response', async () => {
        const mockDb = vi.fn().mockResolvedValue([{ id: 'fb-1' }])
        mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
        const adapter = new DiscordAdapter('token', 'chan', rawPubKeyHex)
        const body = JSON.stringify({
          type: 2,
          data: { name: 'approve', options: [{ name: 'id', value: 'fb-1' }] },
        })
        const ts = String(Date.now())
        const result = await adapter.handleInteraction(body, discordSign(ts, body), ts)
        expect(result).toMatchObject({ type: 4, data: { content: 'Evolution fb-1 approved.' } })
        expect(mockDb).toHaveBeenCalled()
      })

      it('handles /reject command and returns interaction response', async () => {
        const mockDb = vi.fn().mockResolvedValue([{ id: 'fb-2' }])
        mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
        const adapter = new DiscordAdapter('token', 'chan', rawPubKeyHex)
        const body = JSON.stringify({
          type: 2,
          data: { name: 'reject', options: [{ name: 'id', value: 'fb-2' }] },
        })
        const ts = String(Date.now())
        const result = await adapter.handleInteraction(body, discordSign(ts, body), ts)
        expect(result).toMatchObject({ type: 4, data: { content: 'Evolution fb-2 rejected.' } })
      })

      it('handles /approve not found', async () => {
        const mockDb = vi.fn().mockResolvedValue([])
        mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
        const adapter = new DiscordAdapter('token', 'chan', rawPubKeyHex)
        const body = JSON.stringify({
          type: 2,
          data: { name: 'approve', options: [{ name: 'id', value: 'fb-missing' }] },
        })
        const ts = String(Date.now())
        const result = await adapter.handleInteraction(body, discordSign(ts, body), ts)
        expect(result).toMatchObject({ type: 4, data: { content: 'No feedback found with id fb-missing' } })
      })

      it('handles /status command', async () => {
        const mockDb = vi.fn()
          .mockResolvedValueOnce([{ running: '1', pending: '0', completed: '3', failed: '0' }])
          .mockResolvedValueOnce([{ count: '2' }])
        mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
        const adapter = new DiscordAdapter('token', 'chan', rawPubKeyHex)
        const body = JSON.stringify({ type: 2, data: { name: 'status', options: [] } })
        const ts = String(Date.now())
        const result = await adapter.handleInteraction(body, discordSign(ts, body), ts)
        expect((result?.['data'] as Record<string, unknown>)?.['content']).toContain('running: 1')
      })

      it('handles /jobs command', async () => {
        const mockDb = vi.fn().mockResolvedValue([
          { id: 'j1', description: 'test task', status: 'completed', created_at: new Date() },
        ])
        mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
        const adapter = new DiscordAdapter('token', 'chan', rawPubKeyHex)
        const body = JSON.stringify({ type: 2, data: { name: 'jobs', options: [] } })
        const ts = String(Date.now())
        const result = await adapter.handleInteraction(body, discordSign(ts, body), ts)
        expect((result?.['data'] as Record<string, unknown>)?.['content']).toContain('j1')
      })

      it('handles /mcp command', async () => {
        const mockDb = vi.fn().mockResolvedValue([
          { name: 'pg-mcp', status: 'operational', tools_found: ['query', 'schema'] },
        ])
        mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
        const adapter = new DiscordAdapter('token', 'chan', rawPubKeyHex)
        const body = JSON.stringify({ type: 2, data: { name: 'mcp', options: [] } })
        const ts = String(Date.now())
        const result = await adapter.handleInteraction(body, discordSign(ts, body), ts)
        expect((result?.['data'] as Record<string, unknown>)?.['content']).toContain('pg-mcp')
      })

      it('handles /logs command', async () => {
        const mockDb = vi.fn().mockResolvedValue([
          { source: 'core', message: 'startup complete', ts: new Date() },
        ])
        mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
        const adapter = new DiscordAdapter('token', 'chan', rawPubKeyHex)
        const body = JSON.stringify({ type: 2, data: { name: 'logs', options: [] } })
        const ts = String(Date.now())
        const result = await adapter.handleInteraction(body, discordSign(ts, body), ts)
        expect((result?.['data'] as Record<string, unknown>)?.['content']).toContain('core')
      })

      it('handles /feedback command and queues feedback', async () => {
        const adapter = new DiscordAdapter('token', 'chan', rawPubKeyHex)
        const body = JSON.stringify({
          type: 2,
          data: { name: 'feedback', options: [{ name: 'text', value: 'improve validation' }] },
        })
        const ts = String(Date.now())
        const result = await adapter.handleInteraction(body, discordSign(ts, body), ts)
        expect(mockEnqueue).toHaveBeenCalledWith('ouro_feedback', expect.objectContaining({
          source: 'discord',
          text: 'improve validation',
          status: 'pending',
        }))
        expect((result?.['data'] as Record<string, unknown>)?.['content']).toContain('Feedback queued')
      })

      it('handles /task command and queues task', async () => {
        const mockDb = vi.fn().mockResolvedValue([])
        mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>)
        process.env['OURO_REPO_ROOT'] = '/tmp/repo'
        const adapter = new DiscordAdapter('token', 'chan', rawPubKeyHex)
        const body = JSON.stringify({
          type: 2,
          data: {
            name: 'task',
            options: [
              { name: 'instructions', value: 'Add error handling' },
              { name: 'backend', value: 'git' },
              { name: 'target', value: 'https://github.com/x/y' },
            ],
          },
        })
        const ts = String(Date.now())
        const result = await adapter.handleInteraction(body, discordSign(ts, body), ts)
        expect(mockEnqueue).toHaveBeenCalledWith('ouro_tasks', expect.objectContaining({
          backend: 'git',
          target: 'https://github.com/x/y',
          instructions: 'Add error handling',
        }))
        expect((result?.['data'] as Record<string, unknown>)?.['content']).toContain('Task queued')
        delete process.env['OURO_REPO_ROOT']
      })

      it('returns PONG for unknown interaction type', async () => {
        const adapter = new DiscordAdapter('token', 'chan', rawPubKeyHex)
        const body = JSON.stringify({ type: 99 })
        const ts = String(Date.now())
        const result = await adapter.handleInteraction(body, discordSign(ts, body), ts)
        expect(result).toEqual({ type: 1 })
      })

      it('returns null for invalid JSON body', async () => {
        const adapter = new DiscordAdapter('token', 'chan', rawPubKeyHex)
        const body = 'not-json'
        const ts = String(Date.now())
        const result = await adapter.handleInteraction(body, discordSign(ts, body), ts)
        expect(result).toBeNull()
      })
    })
  })
})
