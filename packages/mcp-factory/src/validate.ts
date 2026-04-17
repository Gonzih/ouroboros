import { spawnSync } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { McpServerConfig } from './generate.js'

export interface ValidationResult {
  status: 'operational' | 'partial' | 'failed'
  toolsFound: string[]
  failedTools: string[]
  log: string
  durationMs: number
}

const VALIDATION_PROMPTS: Record<string, string> = {
  pg: `You have access to a PostgreSQL database MCP server. Test it as follows:
1. List all available tools from the MCP server
2. Execute this query using the available tool: SELECT 1 AS connection_test
3. Report which tools you found and whether the query succeeded

At the very end of your response, write one of these markers on its own line:
OPERATIONAL — all tools worked correctly
PARTIAL — some tools worked, others failed
FAILED — could not connect or no tools worked`,

  file: `You have access to a filesystem MCP server. Test it as follows:
1. List all available tools from the MCP server
2. Use the directory listing tool to list the configured directory
3. Report which tools you found and whether the listing succeeded

At the very end of your response, write one of these markers on its own line:
OPERATIONAL — all tools worked correctly
PARTIAL — some tools worked, others failed
FAILED — could not access filesystem or no tools worked`,

  github: `You have access to a GitHub MCP server. Test it as follows:
1. List all available tools from the MCP server
2. Try to use a basic tool like listing repository information or searching repositories
3. Report which tools you found and whether they worked

At the very end of your response, write one of these markers on its own line:
OPERATIONAL — all tools worked correctly
PARTIAL — some tools worked, others failed
FAILED — could not connect to GitHub or no tools worked`,

  sqlite: `You have access to a SQLite database MCP server. Test it as follows:
1. List all available tools from the MCP server
2. Execute this query using the available tool: SELECT 1 AS connection_test
3. Report which tools you found and whether the query succeeded

At the very end of your response, write one of these markers on its own line:
OPERATIONAL — all tools worked correctly
PARTIAL — some tools worked, others failed
FAILED — could not open database or no tools worked`,

  http: `You have access to an HTTP fetch MCP server. Test it as follows:
1. List all available tools from the MCP server
2. Use the fetch tool to retrieve the URL that was configured for this server
3. Report which tools you found and whether the fetch succeeded (any HTTP response, including 4xx, counts as success — we are testing connectivity, not content)

At the very end of your response, write one of these markers on its own line:
OPERATIONAL — all tools worked correctly
PARTIAL — some tools worked, others failed
FAILED — could not connect or no tools worked`,

  https: `You have access to an HTTPS fetch MCP server. Test it as follows:
1. List all available tools from the MCP server
2. Use the fetch tool to retrieve the URL that was configured for this server
3. Report which tools you found and whether the fetch succeeded (any HTTP response, including 4xx, counts as success — we are testing connectivity, not content)

At the very end of your response, write one of these markers on its own line:
OPERATIONAL — all tools worked correctly
PARTIAL — some tools worked, others failed
FAILED — could not connect or no tools worked`,
}

const DEFAULT_PROMPT = `You have access to an MCP server. Test it as follows:
1. List all available tools from the MCP server
2. Call at least one tool to verify it is functional
3. Report which tools you found and whether they worked

At the very end of your response, write one of these markers on its own line:
OPERATIONAL — all tools worked correctly
PARTIAL — some tools worked, others failed
FAILED — could not connect or no tools worked`

function buildPrompt(scheme: string): string {
  return VALIDATION_PROMPTS[scheme] ?? DEFAULT_PROMPT
}

function parseStatus(output: string): 'operational' | 'partial' | 'failed' {
  // Look for the marker on its own line (case-insensitive)
  const lines = output.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? '').trim().toUpperCase()
    if (line === 'OPERATIONAL') return 'operational'
    if (line === 'PARTIAL') return 'partial'
    if (line === 'FAILED') return 'failed'
  }
  // Fallback: search anywhere in output
  if (/\bOPERATIONAL\b/i.test(output)) return 'operational'
  if (/\bPARTIAL\b/i.test(output)) return 'partial'
  return 'failed'
}

function extractTools(output: string): string[] {
  const tools: string[] = []
  // Match patterns like: - tool_name, * tool_name, `tool_name`, "tool_name", tool: tool_name
  const patterns = [
    /`([a-z_][a-z0-9_]*)`/gi,
    /\btool[s]?[:\s]+([a-z_][a-z0-9_]*)/gi,
    /^[-*]\s+([a-z_][a-z0-9_]+)/gim,
  ]
  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(output)) !== null) {
      const name = match[1]
      if (name !== undefined && name.length > 2 && !tools.includes(name)) {
        tools.push(name)
      }
    }
  }
  return tools
}

export async function validateMcp(name: string, config: McpServerConfig, scheme?: string): Promise<ValidationResult> {
  const tempFile = join(tmpdir(), `ouro-validate-${name}-${randomUUID()}.json`)
  const start = Date.now()

  const tempConfig = {
    mcpServers: {
      [name]: {
        command: config.command,
        args: config.args,
        ...(config.env !== undefined ? { env: config.env } : {}),
      },
    },
  }

  try {
    writeFileSync(tempFile, JSON.stringify(tempConfig, null, 2), 'utf8')

    const prompt = buildPrompt(scheme ?? name)
    const result = spawnSync(
      'claude',
      ['--print', '--dangerously-skip-permissions', '--mcp-config', tempFile, '-p', prompt],
      { timeout: 45_000, encoding: 'utf8' }
    )

    const stdout = result.stdout ?? ''
    const stderr = result.stderr ?? ''
    const log = [stdout, stderr].filter(Boolean).join('\n')
    const durationMs = Date.now() - start

    if (result.error !== undefined) {
      // claude binary not found or timed out
      return {
        status: 'failed',
        toolsFound: [],
        failedTools: [],
        log: `Spawn error: ${result.error.message}\n${log}`,
        durationMs,
      }
    }

    const status = parseStatus(stdout)
    const toolsFound = extractTools(stdout)

    return {
      status,
      toolsFound,
      failedTools: [],
      log,
      durationMs,
    }
  } finally {
    try {
      unlinkSync(tempFile)
    } catch {
      // best effort cleanup
    }
  }
}
