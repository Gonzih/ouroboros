import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

// vi.hoisted ensures mockHttpsRequest is defined before the hoisted vi.mock factory runs.
const { mockHttpsRequest } = vi.hoisted(() => ({ mockHttpsRequest: vi.fn() }))

vi.mock('node:https', () => ({
  default: { request: mockHttpsRequest },
}))

vi.mock('@ouroboros/core', () => ({
  log: vi.fn().mockResolvedValue(undefined),
  getDb: vi.fn(),
}))

import { log } from '@ouroboros/core'
import { SlackAdapter } from '../adapters/slack.js'

const mockLog = vi.mocked(log)

// Build a fake IncomingMessage that emits 'data' + 'end' (or 'error') after a tick.
function fakeRes(body: string): EventEmitter {
  const res = new EventEmitter()
  setTimeout(() => {
    res.emit('data', Buffer.from(body))
    res.emit('end')
  }, 0)
  return res
}

// Build a fake ClientRequest. Calling rejectWith() will emit 'error' after a tick.
function fakeReq(rejectWith?: Error): EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> } {
  const req = Object.assign(new EventEmitter(), {
    write: vi.fn(),
    end: vi.fn(),
  })
  if (rejectWith) {
    setTimeout(() => req.emit('error', rejectWith), 0)
  }
  return req
}

describe('SlackAdapter send() → post()', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('resolves silently when Slack API returns { ok: true }', async () => {
    const req = fakeReq()
    const res = fakeRes(JSON.stringify({ ok: true }))
    mockHttpsRequest.mockImplementation((_opts: unknown, cb: (r: EventEmitter) => void) => {
      cb(res)
      return req
    })

    const adapter = new SlackAdapter('xoxb-token', 'C1234')
    await adapter.send('hello')

    expect(mockHttpsRequest).toHaveBeenCalled()
    expect(mockLog).not.toHaveBeenCalled()
  })

  it('logs "send failed" when Slack API returns { ok: false }', async () => {
    const req = fakeReq()
    const res = fakeRes(JSON.stringify({ ok: false, error: 'channel_not_found' }))
    mockHttpsRequest.mockImplementation((_opts: unknown, cb: (r: EventEmitter) => void) => {
      cb(res)
      return req
    })

    const adapter = new SlackAdapter('xoxb-token', 'C1234')
    await adapter.send('test')

    expect(mockLog).toHaveBeenCalledWith('gateway:slack', expect.stringContaining('send failed'))
  })

  it('logs "send failed" on HTTPS request error', async () => {
    const req = fakeReq(new Error('ECONNREFUSED'))
    mockHttpsRequest.mockImplementation(() => req)

    const adapter = new SlackAdapter('xoxb-token', 'C1234')
    await adapter.send('test')

    expect(mockLog).toHaveBeenCalledWith('gateway:slack', expect.stringContaining('send failed'))
  })

  it('logs "send failed" when response body is non-JSON (no ok field)', async () => {
    const req = fakeReq()
    const res = fakeRes('Bad Gateway')
    mockHttpsRequest.mockImplementation((_opts: unknown, cb: (r: EventEmitter) => void) => {
      cb(res)
      return req
    })

    const adapter = new SlackAdapter('xoxb-token', 'C1234')
    await adapter.send('test')

    expect(mockLog).toHaveBeenCalledWith('gateway:slack', expect.stringContaining('send failed'))
  })
})
