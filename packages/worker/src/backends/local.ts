import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { StorageBackend } from './interface.js'

function run(cmd: string, args: string[], cwd?: string): void {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env },
    timeout: 60_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(' ')} exited ${result.status ?? 'signal'}: ${result.stderr ?? ''}`
    )
  }
}

export const localBackend: StorageBackend = {
  name: 'local',

  async prepare(target: string, taskId: string): Promise<string> {
    const dir = resolve(target)
    if (!existsSync(dir)) {
      throw new Error(`local backend target does not exist: ${dir}`)
    }
    if (!existsSync(`${dir}/.git`)) {
      run('git', ['init'], dir)
      run('git', ['add', '-A'], dir)
      run('git', ['commit', '-m', `ouro: baseline before task ${taskId}`], dir)
    }
    return dir
  },

  async commit(dir: string, message: string): Promise<void> {
    run('git', ['add', '-A'], dir)
    run('git', ['commit', '-m', message], dir)
  },

  async cleanup(_dir: string): Promise<void> {
    // no-op — it's the user's own folder
  },
}
