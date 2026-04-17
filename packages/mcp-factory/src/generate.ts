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

    case 'http':
    case 'https':
      // http://host or https://host — general-purpose HTTP fetch MCP server.
      // Claude can use the fetch tool to retrieve content from any URL.
      return {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-fetch', connectionString],
      }

    case 'gdrive': {
      // gdrive:///path/to/service-account.json → credentials file for Google service account auth
      // Obtain a service account JSON from Google Cloud Console (IAM → Service Accounts → Keys)
      // and share your Drive files/folders with the service account email.
      const credPath = connectionString.replace(/^gdrive:\/\//, '')
      return {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-gdrive'],
        env: { GOOGLE_APPLICATION_CREDENTIALS: credPath },
      }
    }

    case 's3':
    case 'onedrive':
      throw new StubError(scheme)

    default:
      throw new StubError(scheme)
  }
}
