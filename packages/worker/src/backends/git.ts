import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
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

export const gitBackend: StorageBackend = {
  name: 'git',

  async prepare(target: string, taskId: string): Promise<string> {
    if (!process.env['GITHUB_TOKEN']) {
      throw new Error('GITHUB_TOKEN is required for git backend')
    }
    const dir = taskDir(taskId)
    run('git', ['clone', target, dir])
    run('git', ['checkout', '-b', `feat/task-${taskId}`], dir)
    return dir
  },

  async commit(dir: string, message: string): Promise<void> {
    const branch = `feat/task-${dir.split('/').pop() ?? 'task'}`
    run('git', ['add', '-A'], dir)
    run('git', ['commit', '-m', message], dir)
    run('git', ['push', '-u', 'origin', branch], dir)
    run('gh', ['pr', 'create', '--title', `task: ${dir.split('/').pop() ?? 'task'}`, '--body', message, '--base', 'main'], dir)
    run('gh', ['pr', 'merge', '--squash', '--auto'], dir)
  },

  async cleanup(dir: string): Promise<void> {
    rmSync(dir, { recursive: true, force: true })
  },
}
