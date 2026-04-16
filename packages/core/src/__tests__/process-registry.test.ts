import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = vi.fn()
vi.mock('../db.js', () => ({
  getDb: () => mockDb
}))

import {
  registerProcess,
  unregisterProcess,
  heartbeat,
  getStaleProcesses,
  setJobSession,
  setJobHeartbeat,
  getStaleJobs,
} from '../process-registry.js'

describe('process-registry', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('registerProcess', () => {
    it('calls db with name, pid, command, args', async () => {
      mockDb.mockResolvedValueOnce([])
      await registerProcess('worker:abc', 1234, 'node', ['dist/index.js'])
      expect(mockDb).toHaveBeenCalledOnce()
    })

    it('does not throw on db success', async () => {
      mockDb.mockResolvedValueOnce([])
      await expect(registerProcess('gateway', 5678, 'node', [])).resolves.toBeUndefined()
    })
  })

  describe('unregisterProcess', () => {
    it('calls db to delete by name', async () => {
      mockDb.mockResolvedValueOnce([])
      await unregisterProcess('worker:abc')
      expect(mockDb).toHaveBeenCalledOnce()
    })
  })

  describe('heartbeat', () => {
    it('calls db update for the given name', async () => {
      mockDb.mockResolvedValueOnce([])
      await heartbeat('gateway')
      expect(mockDb).toHaveBeenCalledOnce()
    })
  })

  describe('getStaleProcesses', () => {
    it('returns array of { name, pid } rows', async () => {
      mockDb.mockResolvedValueOnce([
        { name: 'gateway', pid: 1000 },
        { name: 'ui', pid: 2000 },
      ])
      const result = await getStaleProcesses(60_000)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ name: 'gateway', pid: 1000 })
      expect(result[1]).toEqual({ name: 'ui', pid: 2000 })
    })

    it('returns empty array when no stale processes', async () => {
      mockDb.mockResolvedValueOnce([])
      const result = await getStaleProcesses(60_000)
      expect(result).toHaveLength(0)
    })
  })

  describe('setJobSession', () => {
    it('sets pid and last_heartbeat (no sessionId)', async () => {
      mockDb.mockResolvedValueOnce([])
      await setJobSession('job-1', 1234)
      expect(mockDb).toHaveBeenCalledOnce()
    })

    it('sets pid, session_id and last_heartbeat when sessionId provided', async () => {
      mockDb.mockResolvedValueOnce([])
      await setJobSession('job-1', 1234, 'sess-abc')
      expect(mockDb).toHaveBeenCalledOnce()
    })
  })

  describe('setJobHeartbeat', () => {
    it('calls db update for the given jobId', async () => {
      mockDb.mockResolvedValueOnce([])
      await setJobHeartbeat('job-42')
      expect(mockDb).toHaveBeenCalledOnce()
    })
  })

  describe('getStaleJobs', () => {
    it('returns Job array with fields mapped from snake_case rows', async () => {
      const now = new Date()
      mockDb.mockResolvedValueOnce([
        {
          id: 'job-1',
          description: 'do something',
          backend: 'git',
          target: 'https://github.com/owner/repo',
          status: 'running',
          created_at: now,
          started_at: now,
          completed_at: null,
          error: null,
          pid: 9999,
          session_id: 'sess-xyz',
          last_heartbeat: now,
        },
      ])

      const jobs = await getStaleJobs(10 * 60 * 1000)
      expect(jobs).toHaveLength(1)
      const job = jobs[0]!
      expect(job.id).toBe('job-1')
      expect(job.description).toBe('do something')
      expect(job.backend).toBe('git')
      expect(job.pid).toBe(9999)
      expect(job.sessionId).toBe('sess-xyz')
      expect(job.lastHeartbeat).toBe(now)
    })

    it('omits optional fields when DB values are null', async () => {
      const now = new Date()
      mockDb.mockResolvedValueOnce([
        {
          id: 'job-2',
          description: 'another task',
          backend: 'local',
          target: '/home/user/project',
          status: 'running',
          created_at: now,
          started_at: null,
          completed_at: null,
          error: null,
          pid: null,
          session_id: null,
          last_heartbeat: null,
        },
      ])

      const jobs = await getStaleJobs(10 * 60 * 1000)
      const job = jobs[0]!
      expect(job.pid).toBeUndefined()
      expect(job.sessionId).toBeUndefined()
      expect(job.lastHeartbeat).toBeUndefined()
      expect(job.startedAt).toBeUndefined()
    })

    it('returns empty array when no stale jobs', async () => {
      mockDb.mockResolvedValueOnce([])
      const jobs = await getStaleJobs(10 * 60 * 1000)
      expect(jobs).toHaveLength(0)
    })
  })
})
