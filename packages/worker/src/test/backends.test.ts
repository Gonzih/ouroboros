import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { localBackend } from '../backends/local.js'

test('LocalBackend: prepare initializes git repo if missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ouro-test-'))
  try {
    await writeFile(join(dir, 'hello.txt'), 'hello world')
    const workdir = await localBackend.prepare(dir, 'test-001')
    assert.equal(workdir, resolve(dir))

    // .git should now exist
    const { existsSync } = await import('node:fs')
    assert.ok(existsSync(join(dir, '.git')), '.git directory should exist after prepare')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('LocalBackend: prepare returns absolute path for existing git repo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ouro-test-'))
  try {
    await writeFile(join(dir, 'file.txt'), 'content')
    // Init git first
    const { spawnSync } = await import('node:child_process')
    spawnSync('git', ['init'], { cwd: dir })
    spawnSync('git', ['add', '-A'], { cwd: dir })
    spawnSync('git', ['commit', '-m', 'init', '--allow-empty-message'], { cwd: dir })

    const workdir = await localBackend.prepare(dir, 'test-002')
    assert.equal(workdir, resolve(dir))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('LocalBackend: prepare throws for non-existent directory', async () => {
  await assert.rejects(
    () => localBackend.prepare('/nonexistent/path/that/does/not/exist', 'test-003'),
    /does not exist/
  )
})

test('LocalBackend: commit creates a git commit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ouro-test-'))
  try {
    await writeFile(join(dir, 'base.txt'), 'base')
    await localBackend.prepare(dir, 'test-004')

    // Add a new file
    await writeFile(join(dir, 'new.txt'), 'new content')
    await localBackend.commit(dir, 'ouro task test-004: add new file')

    // Verify git log has the commit
    const { spawnSync } = await import('node:child_process')
    const result = spawnSync('git', ['log', '--oneline'], { cwd: dir, encoding: 'utf8' })
    assert.ok(result.stdout.includes('ouro task test-004'), 'commit message should appear in git log')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('LocalBackend: cleanup is a no-op (directory still exists)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ouro-test-'))
  try {
    await localBackend.cleanup(dir)
    // Dir should still exist
    const { existsSync } = await import('node:fs')
    assert.ok(existsSync(dir), 'directory should still exist after cleanup')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
