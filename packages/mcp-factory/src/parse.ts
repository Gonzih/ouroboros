export class ParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParseError'
  }
}

const KNOWN_SCHEMES = new Set([
  'pg', 'postgres', 'postgresql',
  'file', 'github', 'sqlite',
  's3', 'gdrive', 'onedrive',
  'http', 'https',
])

const NORMALIZE: Record<string, string> = {
  postgres: 'pg',
  postgresql: 'pg',
}

export interface ParsedConnection {
  scheme: string
  path: string
  raw: string
}

export function parseConnectionString(cs: string): ParsedConnection {
  const sepIdx = cs.indexOf('://')
  if (sepIdx === -1) {
    throw new ParseError(`Invalid connection string: missing "://" in "${cs}"`)
  }

  const rawScheme = cs.slice(0, sepIdx).toLowerCase()

  if (!KNOWN_SCHEMES.has(rawScheme)) {
    throw new ParseError(
      `Unknown scheme "${rawScheme}" in "${cs}". Supported: ${[...KNOWN_SCHEMES].join(', ')}`
    )
  }

  const scheme = NORMALIZE[rawScheme] ?? rawScheme
  const path = cs.slice(sepIdx + 3)

  return { scheme, path, raw: cs }
}
