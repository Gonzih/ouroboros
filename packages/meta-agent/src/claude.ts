import { existsSync } from 'node:fs'
import { join } from 'node:path'

const PLATFORM = process.platform

function expandHome(p: string): string {
  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? ''
  return p.startsWith('~') ? join(home, p.slice(1)) : p
}

export function findClaudeBin(): string {
  // 1. Explicit override
  const explicit = process.env['CLAUDE_BIN']
  if (explicit) return explicit

  // 2. Platform-specific well-known paths
  const candidates: string[] = []

  if (PLATFORM === 'win32') {
    const appData = process.env['APPDATA'] ?? ''
    candidates.push(
      join(appData, 'npm', 'claude.cmd'),
      join(appData, 'npm', 'claude'),
    )
  } else {
    candidates.push(
      expandHome('~/.npm-global/bin/claude'),
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      expandHome('~/.local/bin/claude'),
    )
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  // 3. Assume it's in PATH
  return 'claude'
}
