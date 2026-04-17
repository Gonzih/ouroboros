import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn(),
}))

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}))

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: 'ListTools',
  CallToolRequestSchema: 'CallTool',
}))

vi.mock('../tools/jobs.js', () => ({
  jobTools: [{ name: 'list_jobs' }],
  handleJobTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'job' }] }),
}))

vi.mock('../tools/mcp.js', () => ({
  mcpTools: [{ name: 'list_mcps' }],
  handleMcpTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'mcp' }] }),
}))

vi.mock('../tools/feedback.js', () => ({
  feedbackTools: [{ name: 'list_feedback' }],
  handleFeedbackTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'fb' }] }),
}))

vi.mock('../tools/logs.js', () => ({
  logTools: [{ name: 'get_logs' }],
  handleLogTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'log' }] }),
}))

vi.mock('../tools/schedules.js', () => ({
  scheduleTools: [{ name: 'list_schedules' }],
  handleScheduleTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'sched' }] }),
}))

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { handleJobTool } from '../tools/jobs.js'
import { handleMcpTool } from '../tools/mcp.js'
import { handleFeedbackTool } from '../tools/feedback.js'
import { handleLogTool } from '../tools/logs.js'
import { handleScheduleTool } from '../tools/schedules.js'
import { startServer } from '../server.js'

const MockServer = vi.mocked(Server)

type Handler = (req: unknown) => Promise<unknown>

describe('mcp-server routing', () => {
  let listHandler: Handler
  let callHandler: Handler

  beforeEach(async () => {
    vi.clearAllMocks()
    const captured = new Map<string, Handler>()
    MockServer.mockImplementation(() => ({
      setRequestHandler: (schema: string, handler: Handler) => { captured.set(schema, handler) },
      connect: vi.fn().mockResolvedValue(undefined),
    }) as unknown as InstanceType<typeof Server>)

    await startServer()
    listHandler = captured.get('ListTools')!
    callHandler = captured.get('CallTool')!
  })

  it('registers handlers for ListTools and CallTool', () => {
    expect(listHandler).toBeDefined()
    expect(callHandler).toBeDefined()
  })

  it('ListTools returns all five tool groups', async () => {
    const result = await listHandler({}) as { tools: Array<{ name: string }> }
    expect(result.tools).toHaveLength(5)
    const names = result.tools.map(t => t.name)
    expect(names).toContain('list_jobs')
    expect(names).toContain('list_mcps')
    expect(names).toContain('list_feedback')
    expect(names).toContain('get_logs')
    expect(names).toContain('list_schedules')
  })

  it('routes job tool names to handleJobTool', async () => {
    await callHandler({ params: { name: 'list_jobs', arguments: {} } })
    expect(handleJobTool).toHaveBeenCalledWith('list_jobs', {})
  })

  it('routes mcp tool names to handleMcpTool', async () => {
    await callHandler({ params: { name: 'list_mcps', arguments: {} } })
    expect(handleMcpTool).toHaveBeenCalledWith('list_mcps', {})
  })

  it('routes feedback tool names to handleFeedbackTool', async () => {
    await callHandler({ params: { name: 'list_feedback', arguments: {} } })
    expect(handleFeedbackTool).toHaveBeenCalledWith('list_feedback', {})
  })

  it('routes log tool names to handleLogTool', async () => {
    await callHandler({ params: { name: 'get_logs', arguments: {} } })
    expect(handleLogTool).toHaveBeenCalledWith('get_logs', {})
  })

  it('routes schedule tool names to handleScheduleTool', async () => {
    await callHandler({ params: { name: 'list_schedules', arguments: {} } })
    expect(handleScheduleTool).toHaveBeenCalledWith('list_schedules', {})
  })

  it('returns isError:true for an unknown tool name', async () => {
    const result = await callHandler({ params: { name: 'not_a_tool', arguments: {} } }) as {
      isError: boolean
      content: Array<{ type: string; text: string }>
    }
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('Unknown tool: not_a_tool')
  })

  it('wraps handler exceptions as isError responses', async () => {
    vi.mocked(handleJobTool).mockRejectedValueOnce(new Error('db exploded'))
    const result = await callHandler({ params: { name: 'list_jobs', arguments: {} } }) as {
      isError: boolean
      content: Array<{ type: string; text: string }>
    }
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('db exploded')
  })
})
