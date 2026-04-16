import { log as coreLog } from '@ouroboros/core'

export interface ChannelAdapter {
  name: string
  send(message: string): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
}

export class LogAdapter implements ChannelAdapter {
  readonly name = 'log'

  async send(message: string): Promise<void> {
    await coreLog('gateway:log', message)
  }

  async start(): Promise<void> {
    await coreLog('gateway:log', 'log adapter started')
  }

  async stop(): Promise<void> {
    // nothing to tear down
  }
}
