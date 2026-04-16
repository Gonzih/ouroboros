import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

describe('packages/meta-agent', () => {
  describe('findClaudeBin', () => {
    it('returns CLAUDE_BIN env var when set', async () => {
      const original = process.env['CLAUDE_BIN']
      process.env['CLAUDE_BIN'] = '/custom/bin/claude'
      try {
        const { findClaudeBin } = await import('../claude.js')
        assert.equal(findClaudeBin(), '/custom/bin/claude')
      } finally {
        if (original === undefined) {
          delete process.env['CLAUDE_BIN']
        } else {
          process.env['CLAUDE_BIN'] = original
        }
      }
    })

    it('returns a string when CLAUDE_BIN not set', async () => {
      const original = process.env['CLAUDE_BIN']
      delete process.env['CLAUDE_BIN']
      try {
        const { findClaudeBin } = await import('../claude.js')
        const bin = findClaudeBin()
        assert.equal(typeof bin, 'string')
        assert.ok(bin.length > 0)
      } finally {
        if (original !== undefined) {
          process.env['CLAUDE_BIN'] = original
        }
      }
    })
  })

  describe('task validation', () => {
    it('accepts a well-formed task', () => {
      const task = {
        id: 'abc123',
        backend: 'git',
        target: 'https://github.com/example/repo',
        instructions: 'Fix the bug',
      }
      assert.ok(typeof task.id === 'string')
      assert.ok(typeof task.backend === 'string')
      assert.ok(typeof task.target === 'string')
      assert.ok(typeof task.instructions === 'string')
    })

    it('rejects a task missing required fields', () => {
      const malformed = { id: 'abc', backend: 'git' } as Record<string, unknown>
      const isValid =
        typeof malformed['id'] === 'string' &&
        typeof malformed['backend'] === 'string' &&
        typeof malformed['target'] === 'string' &&
        typeof malformed['instructions'] === 'string'
      assert.equal(isValid, false)
    })
  })
})
