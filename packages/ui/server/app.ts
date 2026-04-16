import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import express, { type Express, Router } from 'express'
import { WebSocketServer } from 'ws'
import { getDb, enqueue, log, publish } from '@ouroboros/core'
import { createOidcMiddleware } from '@ouroboros/gateway/oidc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const MCP_FACTORY_PORT = process.env['PORT_MCP_FACTORY'] ?? '7703'
export const MCP_FACTORY_URL = `http://localhost:${MCP_FACTORY_PORT}`

export const app: Express = express()
app.use(express.json())

app.use(express.static(join(__dirname, '..', 'client')))

export const server = createServer(app)
export const wss = new WebSocketServer({ server, path: '/ws' })

export const clients = new Set<{ send(data: string): void; readyState: number }>()

wss.on('connection', (ws) => {
  clients.add(ws)
  ws.on('close', () => { clients.delete(ws) })
  ws.on('error', () => { clients.delete(ws) })
})

export function broadcast(msg: unknown): void {
  const data = JSON.stringify(msg)
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(data)
    }
  }
}

// ---- REST routes (defined on a router, mounted via mountRoutes) ----

const apiRouter = Router()

apiRouter.get('/health', async (_req, res) => {
  try {
    const db = getDb()
    const rows = await db<{ count: string }[]>`SELECT COUNT(*)::text AS count FROM ouro_jobs WHERE status = 'running'`
    const count = parseInt(rows[0]?.count ?? '0', 10)
    res.json({ postgres: true, jobCount: count })
  } catch {
    res.status(500).json({ postgres: false, jobCount: 0 })
  }
})

apiRouter.get('/jobs', async (_req, res) => {
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

apiRouter.get('/jobs/:id/output', async (req, res) => {
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

apiRouter.get('/mcp', async (_req, res) => {
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

apiRouter.get('/feedback', async (_req, res) => {
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

apiRouter.get('/logs', async (_req, res) => {
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

apiRouter.post('/feedback', async (req, res) => {
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

apiRouter.post('/task', async (req, res) => {
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

apiRouter.post('/jobs/:id/cancel', async (req, res) => {
  const id = req.params['id'] ?? ''
  if (!id) { res.status(400).json({ error: 'id required' }); return }
  try {
    const db = getDb()
    const result = await db`
      UPDATE ouro_jobs
      SET status = 'cancellation_requested'
      WHERE id = ${id} AND status IN ('pending', 'running')
    `
    if (result.count === 0) {
      const rows = await db<{ status: string }[]>`SELECT status FROM ouro_jobs WHERE id = ${id}`
      if (rows.length === 0) { res.status(404).json({ error: 'job not found' }); return }
      res.status(409).json({ error: 'job already in terminal state', status: rows[0]?.status })
      return
    }
    await publish('ouro_notify', { type: 'job_cancel_requested', jobId: id })
    await log('ui', `cancel requested for job ${id}`)
    res.json({ ok: true })
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) })
  }
})

apiRouter.post('/jobs/:id/retry', async (req, res) => {
  const id = req.params['id'] ?? ''
  if (!id) { res.status(400).json({ error: 'id required' }); return }
  try {
    const db = getDb()
    const rows = await db<{ description: string; backend: string; target: string; status: string }[]>`
      SELECT description, backend, target, status FROM ouro_jobs WHERE id = ${id}
    `
    if (rows.length === 0) { res.status(404).json({ error: 'job not found' }); return }
    const job = rows[0]!
    if (job.status !== 'failed' && job.status !== 'cancelled') {
      res.status(409).json({ error: 'can only retry failed or cancelled jobs', status: job.status })
      return
    }
    const newId = randomUUID()
    await db`
      INSERT INTO ouro_jobs (id, description, backend, target, status)
      VALUES (${newId}, ${job.description}, ${job.backend}, ${job.target}, 'pending')
    `
    await enqueue('ouro_tasks', { id: newId, backend: job.backend, target: job.target, instructions: job.description })
    await log('ui', `retrying job ${id} as new job ${newId}`)
    res.json({ id: newId })
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) })
  }
})

apiRouter.post('/mcp/register', async (req, res) => {
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

apiRouter.post('/mcp/:name/revalidate', async (req, res) => {
  const name = req.params['name'] ?? ''
  if (!name) { res.status(400).json({ error: 'name required' }); return }
  try {
    const response = await fetch(`${MCP_FACTORY_URL}/mcp/test/${encodeURIComponent(name)}`, {
      method: 'POST'
    })
    const data: unknown = await response.json()
    res.status(response.status).json(data)
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) })
  }
})

apiRouter.delete('/mcp/:name', async (req, res) => {
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

apiRouter.get('/processes', async (_req, res) => {
  try {
    const db = getDb()
    const rows = await db`
      SELECT name, pid, command, args, started_at, last_heartbeat
      FROM ouro_processes
      ORDER BY started_at DESC
    `
    res.json(rows)
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) })
  }
})

apiRouter.get('/workers', async (_req, res) => {
  try {
    const db = getDb()
    // Join running jobs with their process entries (worker:jobId naming convention)
    const rows = await db`
      SELECT
        p.name,
        p.pid,
        p.started_at,
        p.last_heartbeat,
        j.id AS job_id,
        j.description AS job_description,
        j.status AS job_status
      FROM ouro_processes p
      LEFT JOIN ouro_jobs j ON p.name = 'worker:' || j.id
      ORDER BY p.started_at DESC
    `
    res.json(rows)
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) })
  }
})

/**
 * Mount OIDC middleware (if OURO_OIDC_ISSUER is set) then the API router.
 * Must be called before server.listen() so middleware order is correct.
 */
export async function mountRoutes(): Promise<void> {
  const oidcIssuer = process.env['OURO_OIDC_ISSUER']
  if (oidcIssuer) {
    try {
      const oidcMiddleware = await createOidcMiddleware({ issuer: oidcIssuer })
      app.use('/api', oidcMiddleware)
      await log('ui', `OIDC middleware active on /api — issuer: ${oidcIssuer}`)
    } catch (err: unknown) {
      await log('ui', `OIDC setup failed, /api routes unprotected: ${String(err)}`)
    }
  }
  app.use('/api', apiRouter)

  // SPA fallback — must be last
  app.get('*', (_req, res) => {
    res.sendFile(join(__dirname, '..', 'client', 'index.html'))
  })
}
