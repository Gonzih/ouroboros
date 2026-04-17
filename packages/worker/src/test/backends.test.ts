import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { localBackend } from '../backends/local.js'

describe('LocalBackend', () => {
  it('prepare initializes git repo if missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ouro-test-'))
    try {
      await writeFile(join(dir, 'hello.txt'), 'hello world')
      const workdir = await localBackend.prepare(dir, 'test-001')
      expect(workdir).toBe(resolve(dir))
      expect(existsSync(join(dir, '.git'))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('prepare returns absolute path for existing git repo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ouro-test-'))
    try {
      await writeFile(join(dir, 'file.txt'), 'content')
      spawnSync('git', ['init'], { cwd: dir })
      spawnSync('git', ['add', '-A'], { cwd: dir })
      spawnSync('git', ['commit', '-m', 'init', '--allow-empty-message'], { cwd: dir })
      const workdir = await localBackend.prepare(dir, 'test-002')
      expect(workdir).toBe(resolve(dir))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('prepare throws for non-existent directory', async () => {
    await expect(
      localBackend.prepare('/nonexistent/path/that/does/not/exist', 'test-003')
    ).rejects.toThrow(/does not exist/)
  })

  it('commit creates a git commit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ouro-test-'))
    try {
      await writeFile(join(dir, 'base.txt'), 'base')
      await localBackend.prepare(dir, 'test-004')
      await writeFile(join(dir, 'new.txt'), 'new content')
      await localBackend.commit(dir, 'ouro task test-004: add new file')
      const result = spawnSync('git', ['log', '--oneline'], { cwd: dir, encoding: 'utf8' })
      expect(result.stdout).toContain('ouro task test-004')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('cleanup is a no-op (directory still exists)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ouro-test-'))
    try {
      await localBackend.cleanup(dir)
      expect(existsSync(dir)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
