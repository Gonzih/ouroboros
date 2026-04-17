import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createServer as createHttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'

vi.mock('@ouroboros/core', () => ({
  getDb: vi.fn(),
  log: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../parse.js', () => ({
  parseConnectionString: vi.fn(),
  ParseError: class ParseError extends Error { constructor(msg: string) { super(msg); this.name = 'ParseError' } },
}))

vi.mock('../generate.js', () => ({
  generateConfig: vi.fn(),
  StubError: class StubError extends Error { constructor(msg: string) { super(msg); this.name = 'StubError' } },
}))

vi.mock('../validate.js', () => ({
  validateMcp: vi.fn(),
}))

vi.mock('../claude-json.js', () => ({
  patchClaudeJson: vi.fn(),
  removeFromClaudeJson: vi.fn(),
}))

import { getDb } from '@ouroboros/core'
import { parseConnectionString, ParseError } from '../parse.js'
import { generateConfig, StubError } from '../generate.js'
import { validateMcp } from '../validate.js'
import { patchClaudeJson, removeFromClaudeJson } from '../claude-json.js'
import { createServer } from '../server.js'

const mockGetDb = vi.mocked(getDb)
const mockParse = vi.mocked(parseConnectionString)
const mockGenerate = vi.mocked(generateConfig)
const mockValidate = vi.mocked(validateMcp)
const mockPatch = vi.mocked(patchClaudeJson)
const mockRemove = vi.mocked(removeFromClaudeJson)

// mockDbFn is called as a tagged template (db`...`) and also as db.json(...)
// We keep json as a plain function so vi.resetAllMocks() doesn't wipe it
const mockDbFn = vi.fn()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(mockDbFn as any).json = (v: unknown) => v

const sampleConfig = { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/db'] }
const sampleRow = {
  name: 'my-db',
  connection_string: 'pg://localhost/db',
  server_config: sampleConfig,
  status: 'operational',
  validation_log: 'All good',
  tools_found: ['query'],
  registered_at: new Date('2026-01-01T00:00:00Z'),
  validated_at: new Date('2026-01-01T00:01:00Z'),
}

async function withServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = createServer()
  const server = createHttpServer(app)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

describe('mcp-factory server', () => {
  beforeEach(() => {
    // resetAllMocks clears queued once-values so they don't leak across tests
    vi.resetAllMocks()
    mockGetDb.mockReturnValue(mockDbFn)
    mockDbFn.mockResolvedValue([])
    // Re-apply json helper after reset (vi.fn() reset doesn't remove plain properties)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(mockDbFn as any).json = (v: unknown) => v
  })

  describe('POST /mcp/register', () => {
    it('returns 400 when body fails schema validation', async () => {
      await withServer(async (base) => {
        const res = await fetch(`${base}/mcp/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: '', connectionString: 'pg://localhost/db' }),
        })
        expect(res.status).toBe(400)
      })
    })

    it('returns 400 when name contains invalid characters', async () => {
      await withServer(async (base) => {
        const res = await fetch(`${base}/mcp/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'My DB!', connectionString: 'pg://localhost/db' }),
        })
        expect(res.status).toBe(400)
      })
    })

    it('returns 400 when parseConnectionString throws ParseError', async () => {
      mockParse.mockImplementationOnce(() => { throw new ParseError('unsupported scheme') })
      await withServer(async (base) => {
        const res = await fetch(`${base}/mcp/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'my-db', connectionString: 'bad://whatever' }),
        })
        expect(res.status).toBe(400)
        const body = await res.json() as { error: string }
        expect(body.error).toContain('unsupported scheme')
      })
    })

    it('returns 400 when generateConfig throws StubError', async () => {
      mockParse.mockReturnValueOnce({ scheme: 's3', host: 'bucket' })
      mockGenerate.mockImplementationOnce(() => { throw new StubError('s3: not yet implemented') })
      await withServer(async (base) => {
        const res = await fetch(`${base}/mcp/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'my-s3', connectionString: 's3://bucket/path' }),
        })
        expect(res.status).toBe(400)
      })
    })

    it('returns 422 when validation fails', async () => {
      mockParse.mockReturnValueOnce({ scheme: 'pg', host: 'localhost' })
      mockGenerate.mockReturnValueOnce(sampleConfig)
      mockValidate.mockResolvedValueOnce({ status: 'failed', log: 'Connection refused', toolsFound: [] })
      await withServer(async (base) => {
        const res = await fetch(`${base}/mcp/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'my-db', connectionString: 'pg://localhost/db' }),
        })
        expect(res.status).toBe(422)
        const body = await res.json() as { error: string; validationLog: string }
        expect(body.error).toContain('validation failed')
        expect(body.validationLog).toBe('Connection refused')
      })
    })

    it('registers and returns config on success', async () => {
      mockParse.mockReturnValueOnce({ scheme: 'pg', host: 'localhost' })
      mockGenerate.mockReturnValueOnce(sampleConfig)
      mockValidate.mockResolvedValueOnce({ status: 'operational', log: 'All good', toolsFound: ['query'] })
      mockDbFn
        .mockResolvedValueOnce([])       // INSERT upsert
        .mockResolvedValueOnce([sampleRow]) // SELECT after insert
      await withServer(async (base) => {
        const res = await fetch(`${base}/mcp/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'my-db', connectionString: 'pg://localhost/db' }),
        })
        expect(res.status).toBe(200)
        const body = await res.json() as { success: boolean; config: { name: string } }
        expect(body.success).toBe(true)
        expect(body.config.name).toBe('my-db')
        expect(mockPatch).toHaveBeenCalledWith('my-db', sampleConfig)
      })
    })
  })

  describe('GET /mcp/list', () => {
    it('returns empty array when registry is empty', async () => {
      mockDbFn.mockResolvedValueOnce([])
      await withServer(async (base) => {
        const res = await fetch(`${base}/mcp/list`)
        expect(res.status).toBe(200)
        const body = await res.json() as unknown[]
        expect(body).toEqual([])
      })
    })

    it('returns mapped registry rows', async () => {
      mockDbFn.mockResolvedValueOnce([sampleRow])
      await withServer(async (base) => {
        const res = await fetch(`${base}/mcp/list`)
        expect(res.status).toBe(200)
        const body = await res.json() as { name: string; status: string }[]
        expect(body).toHaveLength(1)
        expect(body[0]!.name).toBe('my-db')
        expect(body[0]!.status).toBe('operational')
      })
    })
  })

  describe('POST /mcp/test/:name', () => {
    it('returns 404 when MCP not found', async () => {
      mockDbFn.mockResolvedValueOnce([])
      await withServer(async (base) => {
        const res = await fetch(`${base}/mcp/test/nonexistent`, { method: 'POST' })
        expect(res.status).toBe(404)
      })
    })

    it('re-validates and returns result on success', async () => {
      mockDbFn.mockResolvedValueOnce([sampleRow]) // SELECT
      mockValidate.mockResolvedValueOnce({ status: 'operational', log: 'All good', toolsFound: ['query'] })
      mockDbFn.mockResolvedValueOnce([]) // UPDATE
      await withServer(async (base) => {
        const res = await fetch(`${base}/mcp/test/my-db`, { method: 'POST' })
        expect(res.status).toBe(200)
        const body = await res.json() as { status: string }
        expect(body.status).toBe('operational')
        expect(mockValidate).toHaveBeenCalledWith('my-db', sampleConfig)
      })
    })
  })

  describe('DELETE /mcp/:name', () => {
    it('returns 404 when MCP not found', async () => {
      // postgres.js result has a count property for affected rows
      mockDbFn.mockResolvedValueOnce({ count: 0 })
      await withServer(async (base) => {
        const res = await fetch(`${base}/mcp/nonexistent`, { method: 'DELETE' })
        expect(res.status).toBe(404)
      })
    })

    it('deletes and removes from claude.json on success', async () => {
      mockDbFn.mockResolvedValueOnce({ count: 1 })
      await withServer(async (base) => {
        const res = await fetch(`${base}/mcp/my-db`, { method: 'DELETE' })
        expect(res.status).toBe(200)
        const body = await res.json() as { success: boolean }
        expect(body.success).toBe(true)
        expect(mockRemove).toHaveBeenCalledWith('my-db')
      })
    })
  })
})
