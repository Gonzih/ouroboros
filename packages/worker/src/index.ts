import { migrate } from '@ouroboros/core'
import { run } from './run.js'

export async function start(): Promise<void> {
  await migrate()
  await run()
}
