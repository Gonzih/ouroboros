import type { StorageBackend } from './interface.js'

const MSG = 'gdrive backend not yet implemented — submit feedback to enable this'

export const gdriveBackend: StorageBackend = {
  name: 'gdrive',
  async prepare(_target: string, _taskId: string): Promise<string> {
    throw new Error(MSG)
  },
  async commit(_workdir: string, _message: string): Promise<void> {
    throw new Error(MSG)
  },
  async cleanup(_workdir: string): Promise<void> {
    throw new Error(MSG)
  },
}
