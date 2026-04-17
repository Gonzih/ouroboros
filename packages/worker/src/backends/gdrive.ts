import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  return join('/tmp', `ouro-${taskId}`)
}

// gdrive://1BxiMVs0XRA → gdrive:1BxiMVs0XRA
function toRclonePath(target: string): string {
  return target.replace(/^gdrive:\/\//, 'gdrive:')
}

export const gdriveBackend: StorageBackend = {
  name: 'gdrive',

  async prepare(target: string, taskId: string): Promise<string> {
    const dir = taskDir(taskId)
    mkdirSync(dir, { recursive: true })
    run('rclone', ['copy', toRclonePath(target), dir])
    writeFileSync(join(dir, '.ouro-target'), target, 'utf8')
    return dir
  },

  async commit(workdir: string, _message: string): Promise<void> {
    const target = readFileSync(join(workdir, '.ouro-target'), 'utf8').trim()
    run('rclone', ['copy', workdir, toRclonePath(target), '--exclude', '.ouro-target'])
  },

  async cleanup(workdir: string): Promise<void> {
    spawnSync('rm', ['-rf', workdir], { timeout: 30_000 })
  },
}
