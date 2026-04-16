export * from './types.js'
export { getDb, closeDb } from './db.js'
export { migrate } from './migrate.js'
export { log } from './log.js'
export { publish, subscribe } from './events.js'
export { enqueue, dequeue, ack, nack } from './queue.js'
export { tryAcquireLock, releaseLock } from './locks.js'
export {
  registerProcess,
  unregisterProcess,
  heartbeat,
  getStaleProcesses,
  setJobSession,
  setJobHeartbeat,
  getStaleJobs,
} from './process-registry.js'

export async function start(): Promise<void> {
  console.log('core starting...')
}
