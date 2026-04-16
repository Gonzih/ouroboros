import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}))

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { gitBackend } from '../backends/git.js'
import { localBackend } from '../backends/local.js'

const mockSpawnSync = vi.mocked(spawnSync)
const mockExistsSync = vi.mocked(existsSync)

describe('StorageBackend implementations', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('gitBackend', () => {
    it('has correct name', () => {
      expect(gitBackend.name).toBe('git')
    })

    it('throws when GITHUB_TOKEN is not set', async () => {
      const saved = process.env['GITHUB_TOKEN']
      delete process.env['GITHUB_TOKEN']
      try {
        await expect(gitBackend.prepare('https://github.com/owner/repo', 'task1'))
          .rejects.toThrow('GITHUB_TOKEN')
      } finally {
        if (saved !== undefined) process.env['GITHUB_TOKEN'] = saved
      }
    })

    it('clones repo when GITHUB_TOKEN is set', async () => {
      process.env['GITHUB_TOKEN'] = 'ghp_test'
      mockSpawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '', pid: 1, output: [], signal: null } as ReturnType<typeof spawnSync>)

      const dir = await gitBackend.prepare('https://github.com/owner/repo', 'task1')
      expect(dir).toContain('ouro-task1')
      expect(mockSpawnSync).toHaveBeenCalledWith('git', ['clone', 'https://github.com/owner/repo', expect.stringContaining('ouro-task1')], expect.any(Object))

      delete process.env['GITHUB_TOKEN']
    })
  })

  describe('localBackend', () => {
    it('has correct name', () => {
      expect(localBackend.name).toBe('local')
    })

    it('throws when target directory does not exist', async () => {
      mockExistsSync.mockReturnValue(false)
      await expect(localBackend.prepare('/nonexistent/path', 'task1'))
        .rejects.toThrow('does not exist')
    })

    it('returns target dir when it exists and has .git', async () => {
      mockExistsSync.mockReturnValue(true)
      const dir = await localBackend.prepare('/existing/dir', 'task1')
      expect(dir).toBe('/existing/dir')
    })

    it('cleanup is a no-op (does not throw)', async () => {
      await expect(localBackend.cleanup('/some/dir')).resolves.toBeUndefined()
      // spawnSync should NOT be called for local cleanup
      expect(mockSpawnSync).not.toHaveBeenCalled()
    })
  })
})
