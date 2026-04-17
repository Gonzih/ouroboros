import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { log } from '@ouroboros/core'
import { findClaudeBin } from './claude.js'

function getSessionFile(): string {
  return join(process.env['OURO_REPO_ROOT'] ?? '.', '.ouro-session')
}

export function loadSessionId(): string | undefined {
  if (existsSync(getSessionFile())) {
    const content = readFileSync(getSessionFile(), 'utf8').trim()
    return content || undefined
  }
  return undefined
}

export function saveSessionId(id: string): void {
  writeFileSync(getSessionFile(), id)
}

export function buildCoordinatorPrompt(): string {
  return `You are the Ouroboros coordinator. You have access to the ouroboros MCP server which gives you full control over the system.

Your job:
1. Monitor workers — list_jobs() to find pending/stuck. spawn_worker() for new tasks queued by users.
2. Process feedback — list_feedback(status='pending') every few minutes. Reason about each item, act on it.
3. Watch evolutions — list_feedback(status='pr_open') to find pending approvals. Review the PR, call approve_evolution(id) or reject_evolution(id). If you approve, also run: gh pr merge --squash {pr_url} to complete the merge. If merge fails, the item will show as merge_failed — you can retry with approve_evolution(id) and gh pr merge again.
4. Self-diagnose — get_logs() to spot errors. Use tools to fix what's broken.
5. MCP awareness — list_mcps() to know what data sources are connected.

Be autonomous. Act on what needs action. Check state periodically. When you finish a cycle, wait a moment then check again.
The system is Ouroboros v1.1.0. Running with --continue so your context persists across restarts.`
}

export async function spawnCoordinator(): Promise<ChildProcess> {
  const repoRoot = process.env['OURO_REPO_ROOT'] ?? '.'
  const mcpConfig = join(repoRoot, 'claude-control.json')
  const sessionId = loadSessionId()
  const claudeBin = findClaudeBin()

  const args: string[] = [
    '--dangerously-skip-permissions',
    '--mcp-config', mcpConfig,
    '--print',
  ]

  if (sessionId) {
    args.push('--continue', '-p', 'Continue your coordination work. Check system state and act on what needs attention.')
    await log('meta-agent', `Resuming coordinator session ${sessionId}`)
  } else {
    args.push('-p', buildCoordinatorPrompt())
    await log('meta-agent', 'Starting new coordinator session')
  }

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

  // Mark that a session exists so future restarts use --continue
  if (!sessionId) {
    saveSessionId('started')
  }

  return claude
}
