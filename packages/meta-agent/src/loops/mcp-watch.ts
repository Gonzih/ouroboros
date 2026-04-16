import { subscribe, publish, log } from '@ouroboros/core'

interface McpRegisteredEvent {
  type: string
  name: string
  status: string
}

function isMcpRegisteredEvent(payload: unknown): payload is McpRegisteredEvent {
  if (typeof payload !== 'object' || payload === null) return false
  const p = payload as Record<string, unknown>
  return (
    p['type'] === 'mcp_registered' &&
    typeof p['name'] === 'string' &&
    typeof p['status'] === 'string'
  )
}

export async function startMcpWatch(): Promise<() => void> {
  const unsubscribe = await subscribe('ouro_notify', async (payload: unknown) => {
    if (!isMcpRegisteredEvent(payload)) return

    const { name, status } = payload
    await log('meta-agent:mcp-watch', `MCP ${name} registered (status: ${status})`)

    await publish('ouro_notify', {
      type: 'notify',
      text: `MCP ${name} is now ${status} and available as tools in Claude`,
    })
  })

  return unsubscribe
}
