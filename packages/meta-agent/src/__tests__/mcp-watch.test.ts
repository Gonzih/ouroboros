import { describe, it, expect, vi, beforeEach } from 'vitest'

let capturedCallback: ((payload: unknown) => Promise<void>) | undefined

vi.mock('@ouroboros/core', () => ({
  subscribe: vi.fn().mockImplementation(
    (_channel: string, cb: (payload: unknown) => Promise<void>) => {
      capturedCallback = cb
      return Promise.resolve(vi.fn())
    },
  ),
  publish: vi.fn().mockResolvedValue(undefined),
  log: vi.fn().mockResolvedValue(undefined),
}))

import { subscribe, publish, log } from '@ouroboros/core'
import { startMcpWatch } from '../loops/mcp-watch.js'

const mockSubscribe = vi.mocked(subscribe)
const mockPublish = vi.mocked(publish)
const mockLog = vi.mocked(log)

describe('startMcpWatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedCallback = undefined
    mockSubscribe.mockImplementation(
      (_channel: string, cb: (payload: unknown) => Promise<void>) => {
        capturedCallback = cb
        return Promise.resolve(vi.fn())
      },
    )
  })

  it('subscribes to the ouro_notify channel', async () => {
    await startMcpWatch()
    expect(mockSubscribe).toHaveBeenCalledWith('ouro_notify', expect.any(Function))
  })

  it('returns the unsubscribe function', async () => {
    const unsubscribe = await startMcpWatch()
    expect(typeof unsubscribe).toBe('function')
  })

  it('ignores events with a type other than mcp_registered', async () => {
    await startMcpWatch()
    await capturedCallback!({ type: 'job_complete', jobId: '123', status: 'done' })
    expect(mockLog).not.toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('ignores mcp_registered events missing name or status', async () => {
    await startMcpWatch()
    await capturedCallback!({ type: 'mcp_registered' })
    expect(mockLog).not.toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('ignores non-object payloads', async () => {
    await startMcpWatch()
    await capturedCallback!('not-an-object')
    expect(mockLog).not.toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('ignores null payload', async () => {
    await startMcpWatch()
    await capturedCallback!(null)
    expect(mockLog).not.toHaveBeenCalled()
  })

  it('logs when a valid mcp_registered event arrives', async () => {
    await startMcpWatch()
    await capturedCallback!({ type: 'mcp_registered', name: 'my-db', status: 'OPERATIONAL' })
    expect(mockLog).toHaveBeenCalledWith(
      'meta-agent:mcp-watch',
      expect.stringContaining('my-db'),
    )
  })

  it('log message includes the connection status', async () => {
    await startMcpWatch()
    await capturedCallback!({ type: 'mcp_registered', name: 'my-db', status: 'OPERATIONAL' })
    expect(mockLog).toHaveBeenCalledWith(
      'meta-agent:mcp-watch',
      expect.stringContaining('OPERATIONAL'),
    )
  })

  it('publishes a notify event for valid mcp_registered events', async () => {
    await startMcpWatch()
    await capturedCallback!({ type: 'mcp_registered', name: 'analytics', status: 'OPERATIONAL' })
    expect(mockPublish).toHaveBeenCalledWith(
      'ouro_notify',
      expect.objectContaining({ type: 'notify', text: expect.stringContaining('analytics') }),
    )
  })

  it('notification text includes the MCP status', async () => {
    await startMcpWatch()
    await capturedCallback!({ type: 'mcp_registered', name: 'sales-crm', status: 'PARTIAL' })
    const payload = mockPublish.mock.calls[0]![1] as { text: string }
    expect(payload.text).toContain('PARTIAL')
  })
})
