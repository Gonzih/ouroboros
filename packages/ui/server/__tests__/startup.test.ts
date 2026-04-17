import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@ouroboros/core', () => ({
  getDb: vi.fn(),
  enqueue: vi.fn().mockResolvedValue(1n),
  log: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn().mockResolvedValue(() => undefined),
  registerProcess: vi.fn().mockResolvedValue(undefined),
  unregisterProcess: vi.fn().mockResolvedValue(undefined),
  heartbeat: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../app.js', () => ({
  server: {
    listen: vi.fn().mockImplementation((_port: unknown, cb: () => void) => { cb(); return {} }),
    close: vi.fn(),
    on: vi.fn(),
  },
  broadcast: vi.fn(),
  mountRoutes: vi.fn().mockResolvedValue(undefined),
}))

import { registerProcess, unregisterProcess } from '@ouroboros/core'
import { start } from '../index.js'

const mockRegisterProcess = vi.mocked(registerProcess)
const mockUnregisterProcess = vi.mocked(unregisterProcess)

describe('UI server startup', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('registers ui process on start', async () => {
    await Promise.race([start(), new Promise(r => setTimeout(r, 20))])
    expect(mockRegisterProcess).toHaveBeenCalledWith('ui', process.pid, 'node', expect.any(Array))
  })

  it('unregisters ui process on SIGTERM', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    await Promise.race([start(), new Promise(r => setTimeout(r, 20))])
    process.emit('SIGTERM')
    await new Promise(r => setTimeout(r, 10))
    expect(mockUnregisterProcess).toHaveBeenCalledWith('ui')
    exitSpy.mockRestore()
  })
})
