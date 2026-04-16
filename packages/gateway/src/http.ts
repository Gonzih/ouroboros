import { createServer } from 'node:http'
import express from 'express'
import { getDb, publish, log } from '@ouroboros/core'

export const PORT_GATEWAY = parseInt(process.env['PORT_GATEWAY'] ?? '7701', 10)

const app = express()
app.use(express.json())

// POST /approve/:id — approve an evolution proposal
app.post('/approve/:id', async (req, res) => {
  const id = req.params['id'] ?? ''
  if (!id) { res.status(400).json({ error: 'id required' }); return }
  try {
    const db = getDb()
    const result = await db`
      UPDATE ouro_feedback SET status = 'approved' WHERE id = ${id} RETURNING id
    `
    if (result.length === 0) {
      res.status(404).json({ error: `no feedback found with id ${id}` })
      return
    }
    await publish('ouro_notify', { type: 'evolution_approved', id })
    await log('gateway:http', `evolution ${id} approved via HTTP`)
    res.json({ id, status: 'approved' })
  } catch (err: unknown) {
    await log('gateway:http', `approve error: ${String(err)}`)
    res.status(500).json({ error: String(err) })
  }
})

// POST /reject/:id — reject an evolution proposal
app.post('/reject/:id', async (req, res) => {
  const id = req.params['id'] ?? ''
  if (!id) { res.status(400).json({ error: 'id required' }); return }
  const body = req.body as { reason?: unknown }
  const reason = typeof body.reason === 'string' ? body.reason : undefined
  try {
    const db = getDb()
    const result = await db`
      UPDATE ouro_feedback SET status = 'rejected' WHERE id = ${id} RETURNING id
    `
    if (result.length === 0) {
      res.status(404).json({ error: `no feedback found with id ${id}` })
      return
    }
    await publish('ouro_notify', { type: 'evolution_rejected', id, reason })
    await log('gateway:http', `evolution ${id} rejected via HTTP${reason ? `: ${reason}` : ''}`)
    res.json({ id, status: 'rejected' })
  } catch (err: unknown) {
    await log('gateway:http', `reject error: ${String(err)}`)
    res.status(500).json({ error: String(err) })
  }
})

export function startHttpServer(): void {
  const server = createServer(app)
  server.listen(PORT_GATEWAY, () => {
    void log('gateway:http', `HTTP server listening on port ${PORT_GATEWAY}`)
  })
}
