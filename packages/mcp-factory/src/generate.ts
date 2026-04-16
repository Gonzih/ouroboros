export class StubError extends Error {
  constructor(scheme: string) {
    super(`${scheme}: not yet implemented in v1 — submit feedback to enable this`)
    this.name = 'StubError'
  }
}

export interface McpServerConfig {
  command: string
  args: string[]
  env?: Record<string, string>
}

export function generateConfig(scheme: string, connectionString: string): McpServerConfig {
  switch (scheme) {
    case 'pg': {
      // Normalize pg:// → postgresql:// for MCP server compatibility
      const pgUrl = connectionString.startsWith('pg://')
        ? `postgresql://${connectionString.slice(5)}`
        : connectionString
      return {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-postgres', pgUrl],
      }
    }

    case 'file': {
      // file:///abs/path → /abs/path
      const filePath = connectionString.replace(/^file:\/\//, '')
      return {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', filePath],
      }
    }

    case 'github': {
      // github://owner/repo — token from env
      const token = process.env['GITHUB_TOKEN'] ?? ''
      return {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: token },
      }
    }

    case 'sqlite': {
      // sqlite:///abs/path → /abs/path
      const dbPath = connectionString.replace(/^sqlite:\/\//, '')
      return {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-sqlite', '--db-path', dbPath],
      }
    }

    case 's3':
    case 'gdrive':
    case 'onedrive':
    case 'http':
    case 'https':
      throw new StubError(scheme)

    default:
      throw new StubError(scheme)
  }
}
