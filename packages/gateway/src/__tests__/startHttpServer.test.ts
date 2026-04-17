import { describe, it, expect, vi, afterEach } from 'vitest'

// vi.hoisted ensures these are available inside vi.mock factories (which are hoisted).
const { mockListen, mockServer } = vi.hoisted(() => {
  const mockListen = vi.fn()
  const mockServer = { listen: mockListen }
  return { mockListen, mockServer }
})

vi.mock('node:http', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:http')>()
  return { ...original, createServer: vi.fn().mockReturnValue(mockServer) }
})

vi.mock('@ouroboros/core', () => ({
  log: vi.fn().mockResolvedValue(undefined),
  getDb: vi.fn(),
  publish: vi.fn(),
}))

vi.mock('../oidc.js', () => ({
  createOidcMiddleware: vi.fn(),
}))

import { createServer } from 'node:http'
import { log } from '@ouroboros/core'
import { createOidcMiddleware } from '../oidc.js'
import { startHttpServer } from '../http.js'

const mockLog = vi.mocked(log)
const mockCreateServer = vi.mocked(createServer)
const mockCreateOidc = vi.mocked(createOidcMiddleware)

// Flush the microtask queue so any void-async callbacks resolve.
const flush = () => new Promise<void>(r => setTimeout(r, 0))

describe('startHttpServer', () => {
  afterEach(() => {
    vi.clearAllMocks()
    delete process.env['OURO_OIDC_ISSUER']
  })

  it('creates an HTTP server and calls listen', async () => {
    mockListen.mockImplementation((_port: number, cb?: () => void) => { cb?.(); return mockServer })
    await startHttpServer()
    expect(mockCreateServer).toHaveBeenCalled()
    expect(mockListen).toHaveBeenCalled()
  })

  it('logs when the server starts listening', async () => {
    mockListen.mockImplementation((_port: number, cb?: () => void) => { cb?.(); return mockServer })
    await startHttpServer()
    await flush()
    expect(mockLog).toHaveBeenCalledWith('gateway:http', expect.stringContaining('HTTP server listening'))
  })

  it('accepts a SlackAdapter and mounts the events route', async () => {
    mockListen.mockImplementation((_port: number, cb?: () => void) => { cb?.(); return mockServer })
    const slackAdapter = {
      name: 'slack',
      handleEvent: vi.fn().mockResolvedValue({ challenge: 'abc' }),
      send: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }
    // Should not throw — Slack events route is registered before express.json()
    await expect(startHttpServer(slackAdapter as never)).resolves.toBeUndefined()
    expect(mockCreateServer).toHaveBeenCalled()
  })

  it('accepts a DiscordAdapter and mounts the interactions route', async () => {
    mockListen.mockImplementation((_port: number, cb?: () => void) => { cb?.(); return mockServer })
    const discordAdapter = {
      name: 'discord',
      handleInteraction: vi.fn().mockResolvedValue({ type: 1 }),
      send: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }
    // Should not throw — Discord interactions route is registered before express.json()
    await expect(startHttpServer(undefined, discordAdapter as never)).resolves.toBeUndefined()
    expect(mockCreateServer).toHaveBeenCalled()
  })

  it('applies OIDC middleware and logs success when OURO_OIDC_ISSUER is set', async () => {
    process.env['OURO_OIDC_ISSUER'] = 'https://auth.example.com'
    const mockMiddleware = vi.fn()
    mockCreateOidc.mockResolvedValue(mockMiddleware as never)
    mockListen.mockImplementation((_port: number, cb?: () => void) => { cb?.(); return mockServer })

    await startHttpServer()

    expect(mockCreateOidc).toHaveBeenCalledWith({ issuer: 'https://auth.example.com' })
    expect(mockLog).toHaveBeenCalledWith('gateway:http', expect.stringContaining('OIDC middleware active'))
  })

  it('logs warning and still starts when OIDC setup throws', async () => {
    process.env['OURO_OIDC_ISSUER'] = 'https://broken-auth.example.com'
    mockCreateOidc.mockRejectedValue(new Error('discovery failed'))
    mockListen.mockImplementation((_port: number, cb?: () => void) => { cb?.(); return mockServer })

    await startHttpServer()

    expect(mockLog).toHaveBeenCalledWith('gateway:http', expect.stringContaining('OIDC setup failed'))
    expect(mockListen).toHaveBeenCalled()
  })
})
