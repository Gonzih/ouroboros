import { describe, it, expect, vi, afterEach } from 'vitest'

// Mock node:fs so we control existsSync results
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}))

import { existsSync } from 'node:fs'
import { findClaudeBin } from '../claude.js'

const mockExists = vi.mocked(existsSync)

describe('findClaudeBin', () => {
  const savedClaudeBin = process.env['CLAUDE_BIN']

  afterEach(() => {
    vi.clearAllMocks()
    if (savedClaudeBin === undefined) delete process.env['CLAUDE_BIN']
    else process.env['CLAUDE_BIN'] = savedClaudeBin
  })

  it('returns CLAUDE_BIN env var directly when set', () => {
    process.env['CLAUDE_BIN'] = '/custom/path/to/claude'
    const bin = findClaudeBin()
    expect(bin).toBe('/custom/path/to/claude')
    // Should not check filesystem when env var is set
    expect(mockExists).not.toHaveBeenCalled()
  })

  it('returns a non-empty string when CLAUDE_BIN not set', () => {
    delete process.env['CLAUDE_BIN']
    mockExists.mockReturnValue(false)
    const bin = findClaudeBin()
    expect(typeof bin).toBe('string')
    expect(bin.length).toBeGreaterThan(0)
  })

  it('falls back to "claude" when no candidate paths exist', () => {
    delete process.env['CLAUDE_BIN']
    mockExists.mockReturnValue(false)
    const bin = findClaudeBin()
    // When no candidates exist, returns 'claude' (assumes it's in PATH)
    expect(bin).toBe('claude')
  })

  it('returns first existing candidate path on non-Windows', () => {
    if (process.platform === 'win32') return
    delete process.env['CLAUDE_BIN']
    mockExists.mockReturnValue(false)
    mockExists.mockReturnValueOnce(true) // first candidate exists
    const bin = findClaudeBin()
    // Should return the first candidate (not 'claude')
    expect(bin).not.toBe('claude')
  })
})
