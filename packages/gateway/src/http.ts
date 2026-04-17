import { createServer } from 'node:http'
import express from 'express'
import type { Router } from 'express'
import { getDb, publish, log } from '@ouroboros/core'
import { createOidcMiddleware } from './oidc.js'
import type { SlackAdapter } from './adapters/slack.js'

export const PORT_GATEWAY = parseInt(process.env['PORT_GATEWAY'] ?? '7701', 10)

const RATE_LIMIT_MS = 10_000  // 10 seconds per feedback ID

/**
 * Creates a fresh Express router with idempotency + rate-limit guards on
 * /approve/:id and /reject/:id. Returns a new router each call so tests
 * get clean rate-limiter state.
 */
export function createRouter(): Router {
  const router = express.Router()
  const recentRequests = new Map<string, number>()

  function isRateLimited(id: string): boolean {
    const last = recentRequests.get(id)
    if (last !== undefined && Date.now() - last < RATE_LIMIT_MS) return true
    recentRequests.set(id, Date.now())
    return false
  }

  // POST /approve/:id — approve an evolution proposal
  router.post('/approve/:id', async (req, res) => {
    const id = req.params['id'] ?? ''
    if (!id) { res.status(400).json({ error: 'id required' }); return }
    if (isRateLimited(id)) {
      res.status(429).json({ error: 'rate limit: wait before re-submitting this id' })
      return
    }
    try {
      const db = getDb()
      const result = await db`
        UPDATE ouro_feedback SET status = 'approved'
        WHERE id = ${id} AND status NOT IN ('approved', 'rejected')
        RETURNING id
      `
      if (result.length === 0) {
        const existing = await db`SELECT status FROM ouro_feedback WHERE id = ${id}`
        if (existing.length > 0) {
          res.status(409).json({ error: `feedback ${id} is already ${String(existing[0]?.['status'])}` })
        } else {
          res.status(404).json({ error: `no feedback found with id ${id}` })
        }
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
  router.post('/reject/:id', async (req, res) => {
    const id = req.params['id'] ?? ''
    if (!id) { res.status(400).json({ error: 'id required' }); return }
    if (isRateLimited(id)) {
      res.status(429).json({ error: 'rate limit: wait before re-submitting this id' })
      return
    }
    const body = req.body as { reason?: unknown }
    const reason = typeof body.reason === 'string' ? body.reason : undefined
    try {
      const db = getDb()
      const result = await db`
        UPDATE ouro_feedback SET status = 'rejected'
        WHERE id = ${id} AND status NOT IN ('approved', 'rejected')
        RETURNING id
      `
      if (result.length === 0) {
        const existing = await db`SELECT status FROM ouro_feedback WHERE id = ${id}`
        if (existing.length > 0) {
          res.status(409).json({ error: `feedback ${id} is already ${String(existing[0]?.['status'])}` })
        } else {
          res.status(404).json({ error: `no feedback found with id ${id}` })
        }
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

  return router
}

export async function startHttpServer(slackAdapter?: SlackAdapter): Promise<void> {
  const app = express()

  // Slack Events API: must be registered BEFORE express.json() so the raw body
  // is available for HMAC-SHA256 signature verification.
  if (slackAdapter) {
    app.post('/slack/events', express.raw({ type: '*/*' }), (req, res) => {
      const rawBody = Buffer.isBuffer(req.body) ? req.body.toString() : ''
      const timestamp = String(req.headers['x-slack-request-timestamp'] ?? '')
      const signature = String(req.headers['x-slack-signature'] ?? '')
      void slackAdapter.handleEvent(rawBody, timestamp, signature).then((result) => {
        if (result === null) {
          res.status(403).json({ error: 'invalid request' })
          return
        }
        if (result.challenge !== undefined) {
          res.json({ challenge: result.challenge })
          return
        }
        res.json({ ok: true })
      }).catch((err: unknown) => {
        void log('gateway:http', `slack events error: ${String(err)}`)
        res.status(500).json({ error: String(err) })
      })
    })
  }

  app.use(express.json())

  const oidcIssuer = process.env['OURO_OIDC_ISSUER']
  if (oidcIssuer) {
    try {
      const oidcMiddleware = await createOidcMiddleware({ issuer: oidcIssuer })
      app.use(oidcMiddleware)
      await log('gateway:http', `OIDC middleware active — issuer: ${oidcIssuer}`)
    } catch (err: unknown) {
      await log('gateway:http', `OIDC setup failed, routes unprotected: ${String(err)}`)
    }
  }

  app.use(createRouter())

  const server = createServer(app)
  server.listen(PORT_GATEWAY, () => {
    void log('gateway:http', `HTTP server listening on port ${PORT_GATEWAY}`)
  })
}
