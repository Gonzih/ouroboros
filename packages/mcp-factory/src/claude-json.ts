import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { McpServerConfig } from './generate.js'

function getClaudeJsonPath(): string {
  return join(homedir(), '.claude.json')
}

function readClaudeJson(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {}
  try {
    const raw = readFileSync(filePath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return {}
  } catch {
    return {}
  }
}

function writeClaudeJsonAtomic(filePath: string, data: Record<string, unknown>): void {
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, filePath)
}

function getRepoRoot(): string {
  const root = process.env['OURO_REPO_ROOT']
  if (root === undefined || root === '') {
    throw new Error('OURO_REPO_ROOT environment variable is not set')
  }
  return root
}

export function patchClaudeJson(name: string, config: McpServerConfig, filePath?: string): void {
  const path = filePath ?? getClaudeJsonPath()
  const data = readClaudeJson(path)

  const repoRoot = getRepoRoot()

  // Ensure nested structure: data.projects[repoRoot].mcpServers[name]
  if (data['projects'] === undefined || typeof data['projects'] !== 'object' || data['projects'] === null) {
    data['projects'] = {}
  }
  const projects = data['projects'] as Record<string, unknown>

  if (projects[repoRoot] === undefined || typeof projects[repoRoot] !== 'object' || projects[repoRoot] === null) {
    projects[repoRoot] = {}
  }
  const project = projects[repoRoot] as Record<string, unknown>

  if (project['mcpServers'] === undefined || typeof project['mcpServers'] !== 'object' || project['mcpServers'] === null) {
    project['mcpServers'] = {}
  }
  const mcpServers = project['mcpServers'] as Record<string, unknown>

  mcpServers[name] = config

  writeClaudeJsonAtomic(path, data)
}

export function removeFromClaudeJson(name: string, filePath?: string): void {
  const path = filePath ?? getClaudeJsonPath()
  const data = readClaudeJson(path)

  const repoRoot = getRepoRoot()

  const projects = data['projects']
  if (projects === undefined || typeof projects !== 'object' || projects === null) return

  const project = (projects as Record<string, unknown>)[repoRoot]
  if (project === undefined || typeof project !== 'object' || project === null) return

  const mcpServers = (project as Record<string, unknown>)['mcpServers']
  if (mcpServers === undefined || typeof mcpServers !== 'object' || mcpServers === null) return

  delete (mcpServers as Record<string, unknown>)[name]

  writeClaudeJsonAtomic(path, data)
}
