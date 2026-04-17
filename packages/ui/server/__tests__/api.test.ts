import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import request from 'supertest'

// Mock all @ouroboros/core before importing the app
const mockDb = vi.fn()
vi.mock('@ouroboros/core', () => ({
  getDb: () => mockDb,
  enqueue: vi.fn().mockResolvedValue(1n),
  log: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn().mockResolvedValue(() => undefined),
}))

// Mock croner — used by the schedule POST route to validate cron expressions
vi.mock('croner', () => ({
  Cron: vi.fn().mockImplementation((expr: string) => {
    if (expr === 'INVALID') throw new Error('invalid cron')
    return { nextRun: vi.fn().mockReturnValue(new Date('2026-04-17T09:00:00Z')) }
  }),
}))

// Mock @ouroboros/gateway/oidc — OURO_OIDC_ISSUER is not set in tests so middleware is not invoked
vi.mock('@ouroboros/gateway/oidc', () => ({
  createOidcMiddleware: vi.fn().mockResolvedValue((_req: unknown, _res: unknown, next: () => void) => next()),
}))

// Mock ws to avoid port binding
vi.mock('ws', () => ({
  WebSocketServer: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
  }))
}))

// Mock node:http createServer to avoid real binding
vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:http')>()
  return {
    ...actual,
    createServer: vi.fn().mockImplementation((handler) => {
      // Return a minimal fake server object
      return {
        listen: vi.fn().mockImplementation((_port: unknown, cb: (() => void) | undefined) => { if (cb) cb(); return this }),
        close: vi.fn(),
        on: vi.fn(),
      }
    }),
  }
})

import { app, mountRoutes } from '../app.js'
import { enqueue, publish } from '@ouroboros/core'

const mockEnqueue = vi.mocked(enqueue)
const mockPublish = vi.mocked(publish)

// Mount routes once before all tests (OIDC is skipped — OURO_OIDC_ISSUER not set)
beforeAll(async () => {
  await mountRoutes()
})

describe('UI REST API routes', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('GET /api/health', () => {
    it('returns postgres:true when db responds', async () => {
      mockDb.mockResolvedValueOnce([{ count: '3' }])
      const res = await request(app).get('/api/health')
      expect(res.status).toBe(200)
      expect(res.body.postgres).toBe(true)
      expect(res.body.jobCount).toBe(3)
    })

    it('returns postgres:false when db throws', async () => {
      mockDb.mockRejectedValueOnce(new Error('connection refused'))
      const res = await request(app).get('/api/health')
      expect(res.status).toBe(500)
      expect(res.body.postgres).toBe(false)
    })
  })

  describe('GET /api/jobs', () => {
    it('returns job list from db', async () => {
      const jobs = [
        { id: 'j1', description: 'Task 1', status: 'completed' },
        { id: 'j2', description: 'Task 2', status: 'running' },
      ]
      mockDb.mockResolvedValueOnce(jobs)
      const res = await request(app).get('/api/jobs')
      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(2)
      expect(res.body[0].id).toBe('j1')
    })

    it('returns 500 when db throws', async () => {
      mockDb.mockRejectedValueOnce(new Error('db error'))
      const res = await request(app).get('/api/jobs')
      expect(res.status).toBe(500)
    })
  })

  describe('GET /api/jobs/:id/output', () => {
    it('returns job output lines', async () => {
      mockDb.mockResolvedValueOnce([{ line: 'hello', ts: new Date() }])
      const res = await request(app).get('/api/jobs/j1/output')
      expect(res.status).toBe(200)
      expect(res.body[0].line).toBe('hello')
    })
  })

  describe('GET /api/mcp', () => {
    it('returns MCP registry', async () => {
      mockDb.mockResolvedValueOnce([{ name: 'my-db', status: 'operational' }])
      const res = await request(app).get('/api/mcp')
      expect(res.status).toBe(200)
      expect(res.body[0].name).toBe('my-db')
    })
  })

  describe('POST /api/feedback', () => {
    it('creates feedback when text is provided', async () => {
      mockDb.mockResolvedValueOnce([])
      const res = await request(app)
        .post('/api/feedback')
        .send({ text: 'Please add dark mode' })
      expect(res.status).toBe(200)
      expect(typeof res.body.id).toBe('string')
      expect(mockEnqueue).toHaveBeenCalledWith('ouro_feedback', expect.objectContaining({ text: 'Please add dark mode' }))
    })

    it('returns 400 when text is empty', async () => {
      const res = await request(app)
        .post('/api/feedback')
        .send({ text: '   ' })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('text is required')
    })

    it('returns 400 when text is missing', async () => {
      const res = await request(app).post('/api/feedback').send({})
      expect(res.status).toBe(400)
    })
  })

  describe('POST /api/task', () => {
    it('creates task when all fields are provided', async () => {
      mockDb.mockResolvedValueOnce([])
      const res = await request(app)
        .post('/api/task')
        .send({ instructions: 'Fix bug', backend: 'git', target: 'https://github.com/owner/repo' })
      expect(res.status).toBe(200)
      expect(typeof res.body.id).toBe('string')
      expect(mockEnqueue).toHaveBeenCalledWith('ouro_tasks', expect.objectContaining({ backend: 'git' }))
    })

    it('returns 400 when fields are missing', async () => {
      const res = await request(app)
        .post('/api/task')
        .send({ instructions: 'Fix bug' })
      expect(res.status).toBe(400)
    })
  })

  describe('POST /api/jobs/:id/retry', () => {
    it('retries a failed job and enqueues a new task', async () => {
      mockDb
        .mockResolvedValueOnce([{ description: 'Fix bug', backend: 'git', target: 'https://github.com/owner/repo', status: 'failed' }])
        .mockResolvedValueOnce([])
      const res = await request(app).post('/api/jobs/j1/retry')
      expect(res.status).toBe(200)
      expect(typeof res.body.id).toBe('string')
      expect(mockEnqueue).toHaveBeenCalledWith('ouro_tasks', expect.objectContaining({ backend: 'git', instructions: 'Fix bug' }))
    })

    it('returns 409 when job is not in a retryable state', async () => {
      mockDb.mockResolvedValueOnce([{ description: 'Task', backend: 'git', target: 'repo', status: 'running' }])
      const res = await request(app).post('/api/jobs/j1/retry')
      expect(res.status).toBe(409)
      expect(res.body.status).toBe('running')
    })

    it('returns 404 when job does not exist', async () => {
      mockDb.mockResolvedValueOnce([])
      const res = await request(app).post('/api/jobs/no-such-job/retry')
      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/jobs/:id/cancel', () => {
    it('cancels a pending job immediately', async () => {
      mockDb.mockResolvedValueOnce({ count: 1 })
      const res = await request(app).post('/api/jobs/j1/cancel')
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(mockPublish).toHaveBeenCalledWith('ouro_notify', expect.objectContaining({ type: 'job_cancel_requested', jobId: 'j1' }))
    })

    it('sets cancellation_requested for a running job', async () => {
      // pending UPDATE returns 0 rows, running UPDATE returns 1 row
      mockDb.mockResolvedValueOnce({ count: 0 })
      mockDb.mockResolvedValueOnce({ count: 1 })
      const res = await request(app).post('/api/jobs/j1/cancel')
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(mockPublish).toHaveBeenCalledWith('ouro_notify', expect.objectContaining({ type: 'job_cancel_requested', jobId: 'j1' }))
    })

    it('returns 409 when job is already in terminal state', async () => {
      // both UPDATEs return 0 rows, SELECT returns the terminal status
      mockDb.mockResolvedValueOnce({ count: 0 })
      mockDb.mockResolvedValueOnce({ count: 0 })
      mockDb.mockResolvedValueOnce([{ status: 'completed' }])
      const res = await request(app).post('/api/jobs/j1/cancel')
      expect(res.status).toBe(409)
      expect(res.body.status).toBe('completed')
    })

    it('returns 404 when job does not exist', async () => {
      // both UPDATEs return 0 rows, SELECT returns empty
      mockDb.mockResolvedValueOnce({ count: 0 })
      mockDb.mockResolvedValueOnce({ count: 0 })
      mockDb.mockResolvedValueOnce([])
      const res = await request(app).post('/api/jobs/no-such-job/cancel')
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/schedules', () => {
    it('returns schedule list from db', async () => {
      mockDb.mockResolvedValueOnce([
        { id: 's1', name: 'daily', cron_expr: '0 9 * * *', enabled: true }
      ])
      const res = await request(app).get('/api/schedules')
      expect(res.status).toBe(200)
      expect(res.body[0].name).toBe('daily')
    })
  })

  describe('POST /api/schedules', () => {
    it('creates a schedule with valid fields', async () => {
      mockDb.mockResolvedValueOnce([])
      const res = await request(app)
        .post('/api/schedules')
        .send({
          name: 'daily-summary',
          cron_expr: '0 9 * * *',
          backend: 'git',
          target: 'https://github.com/owner/repo',
          instructions: 'Summarize today',
        })
      expect(res.status).toBe(200)
      expect(typeof res.body.id).toBe('string')
    })

    it('returns 400 for missing fields', async () => {
      const res = await request(app)
        .post('/api/schedules')
        .send({ name: 'bad' })
      expect(res.status).toBe(400)
    })

    it('returns 400 for invalid cron expression', async () => {
      const res = await request(app)
        .post('/api/schedules')
        .send({
          name: 'bad-cron',
          cron_expr: 'INVALID',
          backend: 'git',
          target: 'repo',
          instructions: 'Do something',
        })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('invalid cron')
    })
  })

  describe('PATCH /api/schedules/:id', () => {
    it('updates schedule fields and returns ok', async () => {
      mockDb.mockResolvedValueOnce([{ id: 's1' }])
      const res = await request(app)
        .patch('/api/schedules/s1')
        .send({ instructions: 'Updated instructions', target: '/new/path' })
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
    })

    it('returns 400 when no fields provided', async () => {
      const res = await request(app).patch('/api/schedules/s1').send({})
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('at least one field required')
    })

    it('returns 400 for invalid cron expression', async () => {
      const res = await request(app)
        .patch('/api/schedules/s1')
        .send({ cron_expr: 'INVALID' })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('invalid cron')
    })

    it('returns 404 when schedule not found', async () => {
      mockDb.mockResolvedValueOnce([])
      const res = await request(app)
        .patch('/api/schedules/no-such')
        .send({ name: 'new-name' })
      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /api/schedules/:id/toggle', () => {
    it('toggles schedule enabled state', async () => {
      mockDb.mockResolvedValueOnce([{ id: 's1', enabled: false }])
      const res = await request(app).patch('/api/schedules/s1/toggle')
      expect(res.status).toBe(200)
      expect(res.body.enabled).toBe(false)
    })

    it('returns 404 when schedule not found', async () => {
      mockDb.mockResolvedValueOnce([])
      const res = await request(app).patch('/api/schedules/no-such/toggle')
      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /api/schedules/:id', () => {
    it('deletes an existing schedule', async () => {
      mockDb.mockResolvedValueOnce([{ id: 's1' }])
      const res = await request(app).delete('/api/schedules/s1')
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
    })

    it('returns 404 when schedule not found', async () => {
      mockDb.mockResolvedValueOnce([])
      const res = await request(app).delete('/api/schedules/no-such')
      expect(res.status).toBe(404)
    })
  })
})
