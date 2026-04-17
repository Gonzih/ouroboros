import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { gitBackend } from '../backends/git.js'
import { localBackend } from '../backends/local.js'
import { s3Backend } from '../backends/s3.js'
import { gdriveBackend } from '../backends/gdrive.js'
import { onedriveBackend } from '../backends/onedrive.js'

const mockSpawnSync = vi.mocked(spawnSync)
const mockExistsSync = vi.mocked(existsSync)
const mockReadFileSync = vi.mocked(readFileSync)
const mockRmSync = vi.mocked(rmSync)

const ok = { status: 0, stdout: '', stderr: '', pid: 1, output: [], signal: null } as ReturnType<typeof spawnSync>

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
      mockSpawnSync.mockReturnValue(ok)

      const dir = await gitBackend.prepare('https://github.com/owner/repo', 'task1')
      expect(dir).toContain('ouro-task1')
      expect(mockSpawnSync).toHaveBeenCalledWith('git', ['clone', 'https://github.com/owner/repo', expect.stringContaining('ouro-task1')], expect.any(Object))

      delete process.env['GITHUB_TOKEN']
    })

    it('run throws when spawnSync exits with non-zero status', async () => {
      process.env['GITHUB_TOKEN'] = 'ghp_test'
      mockSpawnSync.mockReturnValue({ ...ok, status: 128, stderr: 'Repository not found' })
      await expect(gitBackend.prepare('https://github.com/owner/repo', 'task-err'))
        .rejects.toThrow('exited 128')
      delete process.env['GITHUB_TOKEN']
    })

    it('commit calls git add, commit, push and opens+merges a PR', async () => {
      mockSpawnSync.mockReturnValue(ok)
      await gitBackend.commit('/tmp/ouro-taskC', 'task done')
      expect(mockSpawnSync).toHaveBeenCalledWith('git', ['add', '-A'], expect.objectContaining({ cwd: '/tmp/ouro-taskC' }))
      expect(mockSpawnSync).toHaveBeenCalledWith('git', ['commit', '-m', 'task done'], expect.objectContaining({ cwd: '/tmp/ouro-taskC' }))
      expect(mockSpawnSync).toHaveBeenCalledWith('git', ['push', '-u', 'origin', expect.stringContaining('feat/task')], expect.objectContaining({ cwd: '/tmp/ouro-taskC' }))
      expect(mockSpawnSync).toHaveBeenCalledWith('gh', expect.arrayContaining(['pr', 'create']), expect.objectContaining({ cwd: '/tmp/ouro-taskC' }))
      expect(mockSpawnSync).toHaveBeenCalledWith('gh', expect.arrayContaining(['pr', 'merge']), expect.objectContaining({ cwd: '/tmp/ouro-taskC' }))
    })

    it('cleanup removes the working directory', async () => {
      await gitBackend.cleanup('/tmp/ouro-task-x')
      expect(mockRmSync).toHaveBeenCalledWith('/tmp/ouro-task-x', { recursive: true, force: true })
    })

    it('run throws the process error when spawnSync returns result.error', async () => {
      process.env['GITHUB_TOKEN'] = 'ghp_test'
      const spawnErr = new Error('spawn ENOENT: git not found')
      mockSpawnSync.mockReturnValue({ ...ok, error: spawnErr, status: 0 })
      await expect(gitBackend.prepare('https://github.com/owner/repo', 'task-e1'))
        .rejects.toThrow('spawn ENOENT')
      delete process.env['GITHUB_TOKEN']
    })

    it('run throws with "signal" in the message when status is null and stderr is absent', async () => {
      process.env['GITHUB_TOKEN'] = 'ghp_test'
      mockSpawnSync.mockReturnValue({
        ...ok,
        status: null,
        stderr: undefined as unknown as string,
        signal: 'SIGKILL' as unknown as null,
      })
      await expect(gitBackend.prepare('https://github.com/owner/repo', 'task-sig'))
        .rejects.toThrow('signal')
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

    it('git-initialises directory when .git folder is absent', async () => {
      // first call: dir exists; second call: .git does not exist
      mockExistsSync.mockReturnValueOnce(true).mockReturnValueOnce(false)
      mockSpawnSync.mockReturnValue(ok)
      const dir = await localBackend.prepare('/existing/no-git', 'task5')
      expect(dir).toBe('/existing/no-git')
      expect(mockSpawnSync).toHaveBeenCalledWith('git', ['init'], expect.objectContaining({ cwd: '/existing/no-git' }))
      expect(mockSpawnSync).toHaveBeenCalledWith('git', ['add', '-A'], expect.objectContaining({ cwd: '/existing/no-git' }))
      expect(mockSpawnSync).toHaveBeenCalledWith('git', ['commit', '-m', expect.stringContaining('task5')], expect.objectContaining({ cwd: '/existing/no-git' }))
    })

    it('commit calls git add -A and git commit', async () => {
      mockSpawnSync.mockReturnValue(ok)
      await localBackend.commit('/some/dir', 'ouro: task done')
      expect(mockSpawnSync).toHaveBeenCalledWith('git', ['add', '-A'], expect.objectContaining({ cwd: '/some/dir' }))
      expect(mockSpawnSync).toHaveBeenCalledWith('git', ['commit', '-m', 'ouro: task done'], expect.objectContaining({ cwd: '/some/dir' }))
    })

    it('prepare throws when spawnSync exits with non-zero status', async () => {
      mockExistsSync.mockReturnValueOnce(true).mockReturnValueOnce(false)
      mockSpawnSync.mockReturnValue({ ...ok, status: 128, stderr: 'init failed' })
      await expect(localBackend.prepare('/bad/dir', 'task6')).rejects.toThrow('exited 128')
    })

    it('prepare throws when spawnSync returns a process error', async () => {
      mockExistsSync.mockReturnValueOnce(true).mockReturnValueOnce(false)
      const fsError = new Error('ENOENT: no such file')
      mockSpawnSync.mockReturnValue({ ...ok, error: fsError, status: null })
      await expect(localBackend.prepare('/bad/dir', 'task7')).rejects.toThrow('ENOENT')
    })

    it('prepare throws with "signal" when status is null and stderr is absent', async () => {
      mockExistsSync.mockReturnValueOnce(true).mockReturnValueOnce(false)
      mockSpawnSync.mockReturnValue({
        ...ok,
        error: undefined,
        status: null,
        stderr: undefined as unknown as string,
        signal: 'SIGKILL' as unknown as null,
      })
      await expect(localBackend.prepare('/bad/dir', 'task8')).rejects.toThrow('signal')
    })

    it('cleanup is a no-op (does not throw)', async () => {
      await expect(localBackend.cleanup('/some/dir')).resolves.toBeUndefined()
      // spawnSync should NOT be called for local cleanup
      expect(mockSpawnSync).not.toHaveBeenCalled()
    })
  })

  describe('s3Backend', () => {
    it('has correct name', () => {
      expect(s3Backend.name).toBe('s3')
    })

    it('throws when no AWS credentials are set', async () => {
      const savedKey = process.env['AWS_ACCESS_KEY_ID']
      const savedProfile = process.env['AWS_PROFILE']
      delete process.env['AWS_ACCESS_KEY_ID']
      delete process.env['AWS_PROFILE']
      try {
        await expect(s3Backend.prepare('s3://my-bucket/prefix', 'task1'))
          .rejects.toThrow('AWS_ACCESS_KEY_ID or AWS_PROFILE')
      } finally {
        if (savedKey !== undefined) process.env['AWS_ACCESS_KEY_ID'] = savedKey
        if (savedProfile !== undefined) process.env['AWS_PROFILE'] = savedProfile
      }
    })

    it('syncs from S3 when credentials are present', async () => {
      process.env['AWS_ACCESS_KEY_ID'] = 'AKIATEST'
      mockSpawnSync.mockReturnValue(ok)

      const dir = await s3Backend.prepare('s3://my-bucket/prefix', 'task2')
      expect(dir).toContain('ouro-task2')
      expect(mockSpawnSync).toHaveBeenCalledWith('aws', ['s3', 'sync', 's3://my-bucket/prefix', expect.stringContaining('ouro-task2')], expect.any(Object))
      expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(expect.stringContaining('.ouro-target'), 's3://my-bucket/prefix', 'utf8')

      delete process.env['AWS_ACCESS_KEY_ID']
    })

    it('syncs workdir back to S3 on commit', async () => {
      mockReadFileSync.mockReturnValue('s3://my-bucket/prefix' as unknown as ReturnType<typeof readFileSync>)
      mockSpawnSync.mockReturnValue(ok)

      await s3Backend.commit('/tmp/ouro-task2', 'done')
      expect(mockSpawnSync).toHaveBeenCalledWith('aws', ['s3', 'sync', '/tmp/ouro-task2', 's3://my-bucket/prefix', '--exclude', '.ouro-target'], expect.any(Object))
    })

    it('removes workdir on cleanup', async () => {
      await s3Backend.cleanup('/tmp/ouro-task2')
      expect(mockRmSync).toHaveBeenCalledWith('/tmp/ouro-task2', { recursive: true, force: true })
    })
  })

  describe('gdriveBackend', () => {
    it('has correct name', () => {
      expect(gdriveBackend.name).toBe('gdrive')
    })

    it('copies from gdrive using rclone', async () => {
      mockSpawnSync.mockReturnValue(ok)

      const dir = await gdriveBackend.prepare('gdrive://1BxiMVs0XRA', 'task3')
      expect(dir).toContain('ouro-task3')
      expect(mockSpawnSync).toHaveBeenCalledWith('rclone', ['copy', 'gdrive:1BxiMVs0XRA', expect.stringContaining('ouro-task3')], expect.any(Object))
      expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(expect.stringContaining('.ouro-target'), 'gdrive://1BxiMVs0XRA', 'utf8')
    })

    it('copies workdir back to gdrive on commit', async () => {
      mockReadFileSync.mockReturnValue('gdrive://1BxiMVs0XRA' as unknown as ReturnType<typeof readFileSync>)
      mockSpawnSync.mockReturnValue(ok)

      await gdriveBackend.commit('/tmp/ouro-task3', 'done')
      expect(mockSpawnSync).toHaveBeenCalledWith('rclone', ['copy', '/tmp/ouro-task3', 'gdrive:1BxiMVs0XRA', '--exclude', '.ouro-target'], expect.any(Object))
    })

    it('removes workdir on cleanup', async () => {
      await gdriveBackend.cleanup('/tmp/ouro-task3')
      expect(mockRmSync).toHaveBeenCalledWith('/tmp/ouro-task3', { recursive: true, force: true })
    })
  })

  describe('onedriveBackend', () => {
    it('has correct name', () => {
      expect(onedriveBackend.name).toBe('onedrive')
    })

    it('copies from onedrive using rclone', async () => {
      mockSpawnSync.mockReturnValue(ok)

      const dir = await onedriveBackend.prepare('onedrive://Documents/data', 'task4')
      expect(dir).toContain('ouro-task4')
      expect(mockSpawnSync).toHaveBeenCalledWith('rclone', ['copy', 'onedrive:Documents/data', expect.stringContaining('ouro-task4')], expect.any(Object))
      expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(expect.stringContaining('.ouro-target'), 'onedrive://Documents/data', 'utf8')
    })

    it('copies workdir back to onedrive on commit', async () => {
      mockReadFileSync.mockReturnValue('onedrive://Documents/data' as unknown as ReturnType<typeof readFileSync>)
      mockSpawnSync.mockReturnValue(ok)

      await onedriveBackend.commit('/tmp/ouro-task4', 'done')
      expect(mockSpawnSync).toHaveBeenCalledWith('rclone', ['copy', '/tmp/ouro-task4', 'onedrive:Documents/data', '--exclude', '.ouro-target'], expect.any(Object))
    })

    it('removes workdir on cleanup', async () => {
      await onedriveBackend.cleanup('/tmp/ouro-task4')
      expect(mockRmSync).toHaveBeenCalledWith('/tmp/ouro-task4', { recursive: true, force: true })
    })
  })
})
