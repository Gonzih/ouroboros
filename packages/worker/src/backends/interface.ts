export interface StorageBackend {
  name: string
  // Clone/mount/sync to a local working directory. Returns absolute path to workdir.
  prepare(target: string, taskId: string): Promise<string>
  // Commit/push/sync changes back. message is a short commit/sync description.
  commit(workdir: string, message: string): Promise<void>
  // Clean up workdir after task completes (or fails).
  cleanup(workdir: string): Promise<void>
}
