import express from 'express'
import { z } from 'zod'
import { getDb, publish, log } from '@ouroboros/core'
import { parseConnectionString, ParseError } from './parse.js'
import { generateConfig, StubError, type McpServerConfig } from './generate.js'
import { validateMcp } from './validate.js'
import { patchClaudeJson, removeFromClaudeJson } from './claude-json.js'

const RegisterSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/, 'name must be lowercase alphanumeric, hyphens, or underscores'),
  connectionString: z.string().min(1),
})

interface McpRow {
  name: string
  connection_string: string
  server_config: McpServerConfig
  status: string
  validation_log: string | null
  tools_found: string[] | null
  registered_at: Date
  validated_at: Date | null
}

function rowToConfig(row: McpRow) {
  return {
    name: row.name,
    connectionString: row.connection_string,
    serverConfig: row.server_config,
    status: row.status,
    validationLog: row.validation_log ?? undefined,
    toolsFound: row.tools_found ?? undefined,
    registeredAt: row.registered_at,
    validatedAt: row.validated_at ?? undefined,
  }
}

export function createServer(): express.Application {
  const app = express()
  app.use(express.json())

  // POST /mcp/register
  app.post('/mcp/register', (req, res, next) => {
    void (async () => {
      try {
        const parseResult = RegisterSchema.safeParse(req.body)
        if (!parseResult.success) {
          res.status(400).json({ error: parseResult.error.message })
          return
        }
        const { name, connectionString } = parseResult.data

        let parsed
        try {
          parsed = parseConnectionString(connectionString)
        } catch (err) {
          if (err instanceof ParseError) {
            res.status(400).json({ error: err.message })
            return
          }
          throw err
        }

        let config: McpServerConfig
        try {
          config = generateConfig(parsed.scheme, connectionString)
        } catch (err) {
          if (err instanceof StubError) {
            res.status(400).json({ error: err.message })
            return
          }
          throw err
        }

        const validation = await validateMcp(name, config, parsed.scheme)

        if (validation.status === 'failed') {
          void log('mcp-factory', `MCP "${name}" validation failed`)
          res.status(422).json({ error: 'MCP validation failed', validationLog: validation.log })
          return
        }

        const db = getDb()
        await db`
          INSERT INTO ouro_mcp_registry
            (name, connection_string, server_config, status, validation_log, tools_found, validated_at)
          VALUES
            (${name}, ${connectionString}, ${db.json(JSON.parse(JSON.stringify(config)))}, ${validation.status},
             ${validation.log}, ${validation.toolsFound}, NOW())
          ON CONFLICT (name) DO UPDATE SET
            connection_string = EXCLUDED.connection_string,
            server_config     = EXCLUDED.server_config,
            status            = EXCLUDED.status,
            validation_log    = EXCLUDED.validation_log,
            tools_found       = EXCLUDED.tools_found,
            validated_at      = EXCLUDED.validated_at
        `

        patchClaudeJson(name, config)

        await publish('ouro_notify', { type: 'mcp_registered', name, status: validation.status })
        void log('mcp-factory', `MCP "${name}" registered (${validation.status})`)

        const rows = await db<McpRow[]>`
          SELECT * FROM ouro_mcp_registry WHERE name = ${name}
        `
        const row = rows[0]
        if (row === undefined) {
          res.status(500).json({ error: 'Registration succeeded but row not found' })
          return
        }

        res.json({ success: true, config: rowToConfig(row), validation })
      } catch (err) {
        next(err)
      }
    })()
  })

  // GET /mcp/list
  app.get('/mcp/list', (req, res, next) => {
    void (async () => {
      try {
        const db = getDb()
        const rows = await db<McpRow[]>`
          SELECT * FROM ouro_mcp_registry ORDER BY registered_at DESC
        `
        res.json(rows.map(rowToConfig))
      } catch (err) {
        next(err)
      }
    })()
  })

  // POST /mcp/test/:name
  app.post('/mcp/test/:name', (req, res, next) => {
    void (async () => {
      try {
        const { name } = req.params
        if (name === undefined) {
          res.status(400).json({ error: 'Missing name parameter' })
          return
        }

        const db = getDb()
        const rows = await db<McpRow[]>`
          SELECT * FROM ouro_mcp_registry WHERE name = ${name}
        `
        const row = rows[0]
        if (row === undefined) {
          res.status(404).json({ error: `MCP "${name}" not found` })
          return
        }

        const validation = await validateMcp(name, row.server_config)

        await db`
          UPDATE ouro_mcp_registry
          SET status         = ${validation.status},
              validation_log = ${validation.log},
              tools_found    = ${validation.toolsFound},
              validated_at   = NOW()
          WHERE name = ${name}
        `

        await publish('ouro_notify', { type: 'mcp_revalidated', name, status: validation.status })
        void log('mcp-factory', `MCP "${name}" re-validated (${validation.status})`)
        res.json(validation)
      } catch (err) {
        next(err)
      }
    })()
  })

  // DELETE /mcp/:name
  app.delete('/mcp/:name', (req, res, next) => {
    void (async () => {
      try {
        const { name } = req.params
        if (name === undefined) {
          res.status(400).json({ error: 'Missing name parameter' })
          return
        }

        const db = getDb()
        const result = await db`
          DELETE FROM ouro_mcp_registry WHERE name = ${name}
        `

        if (result.count === 0) {
          res.status(404).json({ error: `MCP "${name}" not found` })
          return
        }

        removeFromClaudeJson(name)
        await publish('ouro_notify', { type: 'mcp_removed', name })
        void log('mcp-factory', `MCP "${name}" removed`)

        res.json({ success: true })
      } catch (err) {
        next(err)
      }
    })()
  })

  // Error handler
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? (err.stack ?? '') : ''
    void log('mcp-factory', `Unhandled error: ${message}`)
    res.status(500).json({ error: 'Internal server error', detail: message, stack })
  })

  return app
}
