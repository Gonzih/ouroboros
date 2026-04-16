import { subscribe, log } from '@ouroboros/core'
import type { ChannelAdapter } from './adapters/log.js'

// ouro_notify event shapes we handle
interface McpRegisteredEvent {
  type: 'mcp_registered'
  name: string
  status: string
  toolsFound?: string[]
}

interface McpRemovedEvent {
  type: 'mcp_removed'
  name: string
}

interface JobCompleteEvent {
  type: 'job_complete'
  jobId: string
  status: string
  error?: string
}

interface EvolutionProposedEvent {
  type: 'evolution_proposed'
  id: string
  diff: string
}

interface EvolutionResultEvent {
  type: 'evolution_result'
  id: string
  status: string
}

type OuroNotifyEvent =
  | McpRegisteredEvent
  | McpRemovedEvent
  | JobCompleteEvent
  | EvolutionProposedEvent
  | EvolutionResultEvent

function isOuroNotifyEvent(payload: unknown): payload is OuroNotifyEvent {
  if (typeof payload !== 'object' || payload === null) return false
  const p = payload as Record<string, unknown>
  return typeof p['type'] === 'string'
}

function formatEvent(event: OuroNotifyEvent): string | null {
  switch (event.type) {
    case 'mcp_registered': {
      const tools = event.toolsFound?.join(', ') ?? 'none'
      return `MCP ${event.name} registered. Status: ${event.status}. Tools: ${tools}`
    }
    case 'mcp_removed':
      return `MCP ${event.name} removed.`
    case 'job_complete': {
      const base = `Job ${event.jobId} ${event.status}.`
      return event.error != null ? `${base} Error: ${event.error}` : base
    }
    case 'evolution_proposed':
      return (
        `Ouroboros updated itself.\n\nDiff:\n${event.diff}\n\n` +
        `/approve ${event.id} to merge, /reject ${event.id} to discard.`
      )
    case 'evolution_result':
      return `Evolution ${event.id} ${event.status}.`
  }
}

export class Gateway {
  private adapters: ChannelAdapter[]
  private unsubscribe: (() => void) | null = null

  constructor(adapters: ChannelAdapter[]) {
    this.adapters = adapters
  }

  async broadcast(message: string): Promise<void> {
    await Promise.all(
      this.adapters.map(async (adapter) => {
        try {
          await adapter.send(message)
        } catch (err: unknown) {
          // Individual adapter failure must not stop others
          await log('gateway', `adapter "${adapter.name}" send error: ${String(err)}`)
        }
      })
    )
  }

  async start(): Promise<void> {
    // Start all adapters
    await Promise.all(
      this.adapters.map(async (adapter) => {
        try {
          await adapter.start()
        } catch (err: unknown) {
          await log('gateway', `adapter "${adapter.name}" start error: ${String(err)}`)
        }
      })
    )

    // Subscribe to LISTEN/NOTIFY events and broadcast to all adapters
    this.unsubscribe = await subscribe('ouro_notify', async (payload: unknown) => {
      if (!isOuroNotifyEvent(payload)) return

      const message = formatEvent(payload)
      if (message === null) return

      await this.broadcast(message)
    })

    await log('gateway', `started with ${this.adapters.length} adapter(s): ${this.adapters.map(a => a.name).join(', ')}`)
  }

  async stop(): Promise<void> {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }

    await Promise.all(
      this.adapters.map(async (adapter) => {
        try {
          await adapter.stop()
        } catch (err: unknown) {
          await log('gateway', `adapter "${adapter.name}" stop error: ${String(err)}`)
        }
      })
    )

    await log('gateway', 'stopped')
  }
}
