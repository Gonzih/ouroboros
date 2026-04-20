import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { log } from '@ouroboros/core'
import { findClaudeBin } from './claude.js'

export function buildCoordinatorPrompt(): string {
  return `You are the Ouroboros coordinator. Use the ouroboros MCP tools to manage the system.

Each cycle:
1. list_jobs() — spawn pending workers, cancel stuck ones, retry failed ones
2. list_feedback(status='pending') — reason about each item, act on it
3. list_feedback(status='pr_open') — review open evolution PRs. Approve or reject via approve_evolution()/reject_evolution(). Merging is a human action only — flag approved PRs by logging: [evolution:approved] <pr_url>
4. get_logs() — spot errors, fix what's broken
5. list_mcps(), list_schedules() — maintain registered sources and schedules

Be autonomous on jobs and feedback. Require human approval for merges.
When tasks are large, use create_plan() to decompose into atomic scoped steps.
Output [coordinator:did-work] on its own line whenever you take a meaningful action.`
}

export async function spawnCoordinator(): Promise<ChildProcess> {
  const repoRoot = process.env['OURO_REPO_ROOT'] ?? '.'
  const mcpConfig = join(repoRoot, 'claude-control.json')
  const claudeBin = findClaudeBin()

  const args: string[] = [
    '--dangerously-skip-permissions',
    '--mcp-config', mcpConfig,
    '--print',
    '-p', buildCoordinatorPrompt(),
  ]

  await log('meta-agent', 'Starting coordinator cycle (stateless)')

  const claude = spawn(claudeBin, args, {
    cwd: repoRoot,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  claude.stdout?.on('data', (data: Buffer) => {
    const text = data.toString()
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed) void log('coordinator', trimmed)
    }
  })

  claude.stderr?.on('data', (data: Buffer) => {
    const text = data.toString().trim()
    if (text) void log('coordinator:err', text)
  })

  return claude
}
