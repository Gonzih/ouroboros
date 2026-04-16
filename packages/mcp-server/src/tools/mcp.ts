import { getDb } from '@ouroboros/core'
import { textResult } from './jobs.js'
import type { ToolResult } from './jobs.js'

const MCP_FACTORY_PORT = process.env['PORT_MCP_FACTORY'] ?? '7703'
const MCP_FACTORY_BASE = `http://localhost:${MCP_FACTORY_PORT}`

export const mcpTools = [
  {
    name: 'list_mcps',
    description: 'List registered MCP servers, optionally filtered by validation status',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: ['operational', 'partial', 'failed', 'pending'],
          description: 'Filter by validation status (omit for all)',
        },
      },
    },
  },
  {
    name: 'register_mcp',
    description: 'Register and validate a new MCP server from a connection string',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Unique name for the MCP server' },
        connection_string: {
          type: 'string',
          description: 'Connection string (e.g. postgres://user:pass@host/db, file:///path)',
        },
      },
      required: ['name', 'connection_string'],
    },
  },
  {
    name: 'delete_mcp',
    description: 'Remove a registered MCP server',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Name of the MCP server to remove' },
      },
      required: ['name'],
    },
  },
  {
    name: 'test_mcp',
    description: 'Re-validate a registered MCP server and update its status',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Name of the MCP server to test' },
      },
      required: ['name'],
    },
  },
]

export async function handleMcpTool(
  name: string,
  args: Record<string, unknown> | undefined,
): Promise<ToolResult> {
  const a = args ?? {}
  const db = getDb()

  if (name === 'list_mcps') {
    const status = typeof a['status'] === 'string' ? a['status'] : null
    const rows = await db`
      SELECT * FROM ouro_mcp_registry
      WHERE (${status}::text IS NULL OR status = ${status})
      ORDER BY registered_at DESC
    `
    return textResult(JSON.stringify(rows, null, 2))
  }

  if (name === 'register_mcp') {
    const mcpName = typeof a['name'] === 'string' ? a['name'] : ''
    const connectionString = typeof a['connection_string'] === 'string' ? a['connection_string'] : ''
    const res = await fetch(`${MCP_FACTORY_BASE}/mcp/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: mcpName, connectionString }),
    })
    const body: unknown = await res.json()
    return textResult(JSON.stringify(body, null, 2))
  }

  if (name === 'delete_mcp') {
    const mcpName = typeof a['name'] === 'string' ? a['name'] : ''
    const res = await fetch(`${MCP_FACTORY_BASE}/mcp/${encodeURIComponent(mcpName)}`, {
      method: 'DELETE',
    })
    const body: unknown = await res.json()
    return textResult(JSON.stringify(body, null, 2))
  }

  if (name === 'test_mcp') {
    const mcpName = typeof a['name'] === 'string' ? a['name'] : ''
    const res = await fetch(`${MCP_FACTORY_BASE}/mcp/test/${encodeURIComponent(mcpName)}`, {
      method: 'POST',
    })
    const body: unknown = await res.json()
    return textResult(JSON.stringify(body, null, 2))
  }

  throw new Error(`Unknown MCP tool: ${name}`)
}
