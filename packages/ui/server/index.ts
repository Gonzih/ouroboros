import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import express from 'express'
import { WebSocketServer } from 'ws'
import { getDb, subscribe, enqueue, log } from '@ouroboros/core'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PORT = parseInt(process.env['PORT_UI'] ?? '7702', 10)
const MCP_FACTORY_PORT = process.env['PORT_MCP_FACTORY'] ?? '7703'
const MCP_FACTORY_URL = `http://localhost:${MCP_FACTORY_PORT}`

const app = express()
app.use(express.json())

// Serve the Vite-built frontend
app.use(express.static(join(__dirname, '..', 'client')))

const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

const clients = new Set<{ send(data: string): void; readyState: number }>()

wss.on('connection', (ws) => {
  clients.add(ws)
  ws.on('close', () => { clients.delete(ws) })
  ws.on('error', () => { clients.delete(ws) })
})

function broadcast(msg: unknown): void {
  const data = JSON.stringify(msg)
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(data)
    }
  }
}

// ---- REST routes ----

app.get('/api/health', async (_req, res) => {
  try {
    const db = getDb()
    const rows = await db<{ count: string }[]>`SELECT COUNT(*)::text AS count FROM ouro_jobs WHERE status = 'running'`
    const count = parseInt(rows[0]?.count ?? '0', 10)
    res.json({ postgres: true, jobCount: count })
  } catch {
    res.status(500).json({ postgres: false, jobCount: 0 })
  }
})

app.get('/api/jobs', async (_req, res) => {
  try {
    const db = getDb()
    const rows = await db`
      SELECT id, description, backend, target, status,
             created_at, started_at, completed_at, error
      FROM ouro_jobs
      ORDER BY created_at DESC
      LIMIT 50
    `
    res.json(rows)
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) })
  }
})

app.get('/api/jobs/:id/output', async (req, res) => {
  const id = req.params['id'] ?? ''
  if (!id) { res.status(400).json({ error: 'id required' }); return }
  try {
    const db = getDb()
    const rows = await db`
      SELECT line, ts FROM ouro_job_output
      WHERE job_id = ${id}
      ORDER BY ts
    `
    res.json(rows)
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) })
  }
})

app.get('/api/mcp', async (_req, res) => {
  try {
    const db = getDb()
    const rows = await db`
      SELECT name, connection_string, status, validation_log,
             tools_found, registered_at, validated_at
      FROM ouro_mcp_registry
      ORDER BY registered_at DESC
    `
    res.json(rows)
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) })
  }
})

app.get('/api/feedback', async (_req, res) => {
  try {
    const db = getDb()
    const rows = await db`
      SELECT id, source, text, status, pr_url, created_at
      FROM ouro_feedback
      ORDER BY created_at DESC
      LIMIT 20
    `
    res.json(rows)
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) })
  }
})

app.get('/api/logs', async (_req, res) => {
  try {
    const db = getDb()
    const rows = await db`
      SELECT id, source, message, ts
      FROM ouro_logs
      ORDER BY ts DESC
      LIMIT 200
    `
    res.json(rows)
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) })
  }
})

app.post('/api/feedback', async (req, res) => {
  const body = req.body as { text?: unknown }
  const text = body.text
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text is required' })
    return
  }
  try {
    const db = getDb()
    const id = randomUUID()
    await db`
      INSERT INTO ouro_feedback (id, source, text, status)
      VALUES (${id}, 'ui', ${text}, 'pending')
    `
    await enqueue('ouro_feedback', { id, source: 'ui', text, status: 'pending' })
    res.json({ id })
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) })
  }
})

app.post('/api/task', async (req, res) => {
  const body = req.body as { instructions?: unknown; backend?: unknown; target?: unknown }
  const instructions = body.instructions
  const backend = body.backend
  const target = body.target
  if (typeof instructions !== 'string' || !instructions.trim() ||
      typeof backend !== 'string' || !backend.trim() ||
      typeof target !== 'string' || !target.trim()) {
    res.status(400).json({ error: 'instructions, backend, target required' })
    return
  }
  try {
    const db = getDb()
    const id = randomUUID()
    await db`
      INSERT INTO ouro_jobs (id, description, backend, target, status)
      VALUES (${id}, ${instructions}, ${backend}, ${target}, 'pending')
    `
    await enqueue('ouro_tasks', { id, backend, target, instructions })
    res.json({ id })
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) })
  }
})

app.post('/api/mcp/register', async (req, res) => {
  try {
    const response = await fetch(`${MCP_FACTORY_URL}/mcp/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    })
    const data: unknown = await response.json()
    res.status(response.status).json(data)
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) })
  }
})

app.delete('/api/mcp/:name', async (req, res) => {
  const name = req.params['name'] ?? ''
  if (!name) { res.status(400).json({ error: 'name required' }); return }
  try {
    const response = await fetch(`${MCP_FACTORY_URL}/mcp/${encodeURIComponent(name)}`, {
      method: 'DELETE'
    })
    const data: unknown = await response.json()
    res.status(response.status).json(data)
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) })
  }
})

// SPA fallback — serve index.html for all non-API routes
app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, '..', 'client', 'index.html'))
})

// ---- Startup ----

export async function start(): Promise<void> {
  const unsub = await subscribe('ouro_notify', async (payload: unknown) => {
    broadcast({ type: 'notify', payload })
  })

  await new Promise<void>((resolve) => {
    server.listen(PORT, () => {
      void log('ui', `UI server listening on port ${PORT}`)
      resolve()
    })
  })

  const shutdown = async (): Promise<void> => {
    await unsub()
    server.close()
    process.exit(0)
  }

  process.on('SIGTERM', () => { void shutdown() })
  process.on('SIGINT', () => { void shutdown() })

  // Keep alive
  await new Promise<never>(() => undefined)
}

await start()
