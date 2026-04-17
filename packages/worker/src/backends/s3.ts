import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StorageBackend } from './interface.js'

function run(cmd: string, args: string[], cwd?: string): void {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env },
    timeout: 120_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(' ')} exited ${result.status ?? 'signal'}: ${result.stderr ?? ''}`
    )
  }
}

function taskDir(taskId: string): string {
  return join(tmpdir(), `ouro-${taskId}`)
}

export const s3Backend: StorageBackend = {
  name: 's3',

  async prepare(target: string, taskId: string): Promise<string> {
    if (!process.env['AWS_ACCESS_KEY_ID'] && !process.env['AWS_PROFILE']) {
      throw new Error('s3 backend requires AWS_ACCESS_KEY_ID or AWS_PROFILE to be set')
    }
    const dir = taskDir(taskId)
    mkdirSync(dir, { recursive: true })
    run('aws', ['s3', 'sync', target, dir])
    // Persist original target so commit() knows where to sync back
    writeFileSync(join(dir, '.ouro-target'), target, 'utf8')
    return dir
  },

  async commit(workdir: string, _message: string): Promise<void> {
    const target = readFileSync(join(workdir, '.ouro-target'), 'utf8').trim()
    run('aws', ['s3', 'sync', workdir, target, '--exclude', '.ouro-target'])
  },

  async cleanup(workdir: string): Promise<void> {
    rmSync(workdir, { recursive: true, force: true })
  },
}
