import { describe, it, expect } from 'vitest'
import type { Job, McpConfig, FeedbackEvent, JobStatus, McpStatus } from '../types.js'

// Type-level tests: verify shapes are correct at runtime
describe('domain type shapes', () => {
  it('Job has required fields', () => {
    const job: Job = {
      id: 'j1',
      description: 'test job',
      backend: 'git',
      target: 'https://github.com/owner/repo',
      status: 'pending',
      createdAt: new Date(),
    }
    expect(job.id).toBe('j1')
    expect(job.status).toBe('pending')
  })

  it('McpConfig has required fields', () => {
    const mcp: McpConfig = {
      name: 'my-db',
      connectionString: 'pg://localhost/mydb',
      serverConfig: { command: 'npx', args: ['...'] },
      status: 'pending',
      registeredAt: new Date(),
    }
    expect(mcp.name).toBe('my-db')
    expect(mcp.status).toBe('pending')
  })

  it('FeedbackEvent has required fields', () => {
    const ev: FeedbackEvent = {
      id: 'f1',
      source: 'ui',
      text: 'please add feature X',
      status: 'pending',
      createdAt: new Date(),
    }
    expect(ev.source).toBe('ui')
    expect(ev.text).toBe('please add feature X')
  })

  it('JobStatus covers expected values', () => {
    const statuses: JobStatus[] = ['pending', 'running', 'completed', 'failed', 'cancelled']
    expect(statuses).toHaveLength(5)
  })

  it('McpStatus covers expected values', () => {
    const statuses: McpStatus[] = ['pending', 'operational', 'partial', 'failed']
    expect(statuses).toHaveLength(4)
  })
})
