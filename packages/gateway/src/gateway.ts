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
  prUrl?: string
  diff?: string
}

interface EvolutionApprovedEvent {
  type: 'evolution_approved'
  id: string
}

interface EvolutionAppliedEvent {
  type: 'evolution_applied'
  id: string
  prUrl?: string
}

interface EvolutionRejectedEvent {
  type: 'evolution_rejected'
  id: string
  prUrl?: string
  reason?: string
}

interface EvolutionMergeFailedEvent {
  type: 'evolution_merge_failed'
  id: string
  prUrl?: string
  error?: string
}

interface EvolutionTimeoutEvent {
  type: 'evolution_timeout'
  id: string
  prUrl?: string
}

type OuroNotifyEvent =
  | McpRegisteredEvent
  | McpRemovedEvent
  | JobCompleteEvent
  | EvolutionProposedEvent
  | EvolutionApprovedEvent
  | EvolutionAppliedEvent
  | EvolutionRejectedEvent
  | EvolutionMergeFailedEvent
  | EvolutionTimeoutEvent

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
    case 'evolution_proposed': {
      const prLine = event.prUrl ? `\nPR: ${event.prUrl}` : ''
      return (
        `Evolution proposed for ${event.id}.${prLine}\n\n` +
        `/approve ${event.id} to merge, /reject ${event.id} to discard.`
      )
    }
    case 'evolution_approved':
      return `Evolution ${event.id} approved — merging PR.`
    case 'evolution_applied': {
      const prLine = event.prUrl ? ` (${event.prUrl})` : ''
      return `Evolution ${event.id} applied${prLine}. Rebuilding and restarting.`
    }
    case 'evolution_rejected': {
      const reason = event.reason ? `: ${event.reason}` : ''
      return `Evolution ${event.id} rejected${reason}.`
    }
    case 'evolution_merge_failed': {
      const errLine = event.error ? `: ${event.error}` : ''
      return `Evolution ${event.id} merge failed${errLine}. Approve again to retry.`
    }
    case 'evolution_timeout': {
      const prLine = event.prUrl ? ` (${event.prUrl})` : ''
      return `Evolution ${event.id} timed out after 7 days${prLine}. PR has been closed.`
    }
    default:
      return null
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
