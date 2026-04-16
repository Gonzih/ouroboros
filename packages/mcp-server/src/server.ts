import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { jobTools, handleJobTool } from './tools/jobs.js'
import { mcpTools, handleMcpTool } from './tools/mcp.js'
import { feedbackTools, handleFeedbackTool } from './tools/feedback.js'
import { logTools, handleLogTool } from './tools/logs.js'
import { scheduleTools, handleScheduleTool } from './tools/schedules.js'

const allTools = [...jobTools, ...mcpTools, ...feedbackTools, ...logTools, ...scheduleTools]

export async function startServer(): Promise<void> {
  const server = new Server(
    { name: 'ouroboros', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: allTools }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    try {
      if (jobTools.find(t => t.name === name) !== undefined) return handleJobTool(name, args)
      if (mcpTools.find(t => t.name === name) !== undefined) return handleMcpTool(name, args)
      if (feedbackTools.find(t => t.name === name) !== undefined) return handleFeedbackTool(name, args)
      if (logTools.find(t => t.name === name) !== undefined) return handleLogTool(name, args)
      if (scheduleTools.find(t => t.name === name) !== undefined) return handleScheduleTool(name, args)
      throw new Error(`Unknown tool: ${name}`)
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${String(err)}` }],
        isError: true,
      }
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
