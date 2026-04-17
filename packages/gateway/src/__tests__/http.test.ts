import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import crypto from 'node:crypto'

vi.mock('@ouroboros/core', () => ({
  getDb: vi.fn(),
  log: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(undefined),
}))

import { getDb, publish } from '@ouroboros/core'
import { createRouter } from '../http.js'
import { SlackAdapter } from '../adapters/slack.js'

const mockGetDb = vi.mocked(getDb)

function slackSignature(secret: string, timestamp: string, body: string): string {
  return 'v0=' + crypto.createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')
}

// Spin up a server that includes the Slack events route (mimics startHttpServer behaviour)
async function withSlackServer(
  slackAdapter: SlackAdapter,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express()
  app.post('/slack/events', express.raw({ type: '*/*' }), (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString() : ''
    const timestamp = String(req.headers['x-slack-request-timestamp'] ?? '')
    const signature = String(req.headers['x-slack-signature'] ?? '')
    void slackAdapter.handleEvent(rawBody, timestamp, signature).then((result) => {
      if (result === null) { res.status(403).json({ error: 'invalid request' }); return }
      if (result.challenge !== undefined) { res.json({ challenge: result.challenge }); return }
      res.json({ ok: true })
    }).catch((err: unknown) => {
      res.status(500).json({ error: String(err) })
    })
  })
  app.use(express.json())
  app.use(createRouter())
  const server = createServer(app)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}
const mockPublish = vi.mocked(publish)

// Spin up a real HTTP server on a random port for each test.
// This exercises the full Express middleware chain without supertest.
async function withServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express()
  app.use(express.json())
  app.use(createRouter())
  const server = createServer(app)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

// Build a mock db tag that returns the given rows on each sequential call
function mockDb(...rowSets: unknown[][]): ReturnType<typeof getDb> {
  let call = 0
  const fn = vi.fn().mockImplementation(() => {
    const rows = rowSets[call] ?? []
    call++
    return Promise.resolve(rows)
  })
  return fn as unknown as ReturnType<typeof getDb>
}

describe('HTTP approval routes', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('POST /approve/:id', () => {
    it('returns 200 and publishes evolution_approved when pending', async () => {
      mockGetDb.mockReturnValue(mockDb([{ id: 'fb-1' }]))
      await withServer(async (base) => {
        const res = await fetch(`${base}/approve/fb-1`, { method: 'POST' })
        expect(res.status).toBe(200)
        const body = await res.json() as { id: string; status: string }
        expect(body).toEqual({ id: 'fb-1', status: 'approved' })
        expect(mockPublish).toHaveBeenCalledWith('ouro_notify', { type: 'evolution_approved', id: 'fb-1' })
      })
    })

    it('returns 404 when feedback id does not exist', async () => {
      // First call: UPDATE returns 0 rows; second call: SELECT returns 0 rows
      mockGetDb.mockReturnValue(mockDb([], []))
      await withServer(async (base) => {
        const res = await fetch(`${base}/approve/unknown-id`, { method: 'POST' })
        expect(res.status).toBe(404)
      })
    })

    it('returns 409 when feedback is already approved', async () => {
      // First call: UPDATE returns 0 (status filter); second call: SELECT returns existing row
      mockGetDb.mockReturnValue(mockDb([], [{ status: 'approved' }]))
      await withServer(async (base) => {
        const res = await fetch(`${base}/approve/fb-dup`, { method: 'POST' })
        expect(res.status).toBe(409)
        const body = await res.json() as { error: string }
        expect(body.error).toMatch(/already approved/)
      })
    })

    it('returns 429 when the same id is submitted twice rapidly', async () => {
      mockGetDb.mockReturnValue(mockDb([{ id: 'fb-spam' }]))
      await withServer(async (base) => {
        const first = await fetch(`${base}/approve/fb-spam`, { method: 'POST' })
        expect(first.status).toBe(200)

        // Immediate second request — hits rate limit
        const second = await fetch(`${base}/approve/fb-spam`, { method: 'POST' })
        expect(second.status).toBe(429)
      })
    })
  })

  describe('POST /reject/:id', () => {
    it('returns 200 and publishes evolution_rejected', async () => {
      mockGetDb.mockReturnValue(mockDb([{ id: 'fb-2' }]))
      await withServer(async (base) => {
        const res = await fetch(`${base}/reject/fb-2`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'too risky' }),
        })
        expect(res.status).toBe(200)
        const body = await res.json() as { id: string; status: string }
        expect(body).toEqual({ id: 'fb-2', status: 'rejected' })
        expect(mockPublish).toHaveBeenCalledWith('ouro_notify', {
          type: 'evolution_rejected',
          id: 'fb-2',
          reason: 'too risky',
        })
      })
    })

    it('returns 409 when feedback is already rejected', async () => {
      mockGetDb.mockReturnValue(mockDb([], [{ status: 'rejected' }]))
      await withServer(async (base) => {
        const res = await fetch(`${base}/reject/fb-done`, { method: 'POST' })
        expect(res.status).toBe(409)
      })
    })

    it('returns 429 on rapid duplicate reject', async () => {
      mockGetDb.mockReturnValue(mockDb([{ id: 'fb-r' }]))
      await withServer(async (base) => {
        const first = await fetch(`${base}/reject/fb-r`, { method: 'POST' })
        expect(first.status).toBe(200)
        const second = await fetch(`${base}/reject/fb-r`, { method: 'POST' })
        expect(second.status).toBe(429)
      })
    })
  })
})

describe('POST /slack/events', () => {
  const secret = 'slack-signing-secret'

  beforeEach(() => { vi.clearAllMocks() })

  it('returns 403 on invalid signature', async () => {
    const adapter = new SlackAdapter('token', 'chan', secret)
    const timestamp = String(Math.floor(Date.now() / 1000))
    await withSlackServer(adapter, async (base) => {
      const res = await fetch(`${base}/slack/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-slack-request-timestamp': timestamp,
          'x-slack-signature': 'v0=badsignature',
        },
        body: '{}',
      })
      expect(res.status).toBe(403)
    })
  })

  it('responds to URL verification challenge', async () => {
    const adapter = new SlackAdapter('token', 'chan', secret)
    const timestamp = String(Math.floor(Date.now() / 1000))
    const body = JSON.stringify({ type: 'url_verification', challenge: 'xyz789' })
    const sig = slackSignature(secret, timestamp, body)
    await withSlackServer(adapter, async (base) => {
      const res = await fetch(`${base}/slack/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-slack-request-timestamp': timestamp,
          'x-slack-signature': sig,
        },
        body,
      })
      expect(res.status).toBe(200)
      const json = await res.json() as { challenge: string }
      expect(json.challenge).toBe('xyz789')
    })
  })

  it('returns 200 ok for valid event_callback', async () => {
    const adapter = new SlackAdapter('token', 'chan', secret)
    vi.spyOn(adapter, 'send').mockResolvedValue(undefined)
    const timestamp = String(Math.floor(Date.now() / 1000))
    const body = JSON.stringify({
      type: 'event_callback',
      event: { type: 'reaction_added' },
    })
    const sig = slackSignature(secret, timestamp, body)
    await withSlackServer(adapter, async (base) => {
      const res = await fetch(`${base}/slack/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-slack-request-timestamp': timestamp,
          'x-slack-signature': sig,
        },
        body,
      })
      expect(res.status).toBe(200)
      const json = await res.json() as { ok: boolean }
      expect(json.ok).toBe(true)
    })
  })
})
