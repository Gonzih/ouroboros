import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@ouroboros/core', () => ({
  migrate: vi.fn().mockResolvedValue(undefined),
  closeDb: vi.fn().mockResolvedValue(undefined),
  log: vi.fn().mockResolvedValue(undefined),
  registerProcess: vi.fn().mockResolvedValue(undefined),
  unregisterProcess: vi.fn().mockResolvedValue(undefined),
  heartbeat: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../http.js', () => ({
  startHttpServer: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../gateway.js', () => ({
  Gateway: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('../adapters/log.js', () => ({
  LogAdapter: vi.fn().mockImplementation(() => ({})),
}))
vi.mock('../adapters/telegram.js', () => ({ TelegramAdapter: vi.fn() }))
vi.mock('../adapters/slack.js', () => ({ SlackAdapter: vi.fn() }))
vi.mock('../adapters/webhook.js', () => ({ WebhookAdapter: vi.fn() }))

import { registerProcess, unregisterProcess } from '@ouroboros/core'
import { start } from '../index.js'

const mockRegisterProcess = vi.mocked(registerProcess)
const mockUnregisterProcess = vi.mocked(unregisterProcess)

describe('gateway startup', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('registers gateway process on start', async () => {
    // Race against the infinite promise at the end of start()
    await Promise.race([start(), new Promise(r => setTimeout(r, 20))])
    expect(mockRegisterProcess).toHaveBeenCalledWith('gateway', process.pid, 'node', expect.any(Array))
  })

  it('unregisters gateway process on SIGTERM', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    await Promise.race([start(), new Promise(r => setTimeout(r, 20))])
    process.emit('SIGTERM')
    await new Promise(r => setTimeout(r, 10))
    expect(mockUnregisterProcess).toHaveBeenCalledWith('gateway')
    exitSpy.mockRestore()
  })
})
