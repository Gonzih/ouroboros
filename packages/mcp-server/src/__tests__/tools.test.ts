import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@ouroboros/core', () => ({
  getDb: vi.fn(),
  log: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(undefined),
  enqueue: vi.fn().mockResolvedValue(BigInt(1)),
}))

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}))

import { getDb, log, publish, enqueue } from '@ouroboros/core'
import { spawnSync } from 'node:child_process'

const mockSpawnSync = vi.mocked(spawnSync)
import { handleJobTool } from '../tools/jobs.js'
import { handleMcpTool } from '../tools/mcp.js'
import { handleFeedbackTool } from '../tools/feedback.js'
import { handleLogTool } from '../tools/logs.js'

const mockGetDb = vi.mocked(getDb)
const mockLog = vi.mocked(log)
const mockPublish = vi.mocked(publish)
const mockEnqueue = vi.mocked(enqueue)

function makeDbMock(rows: unknown[] = []) {
  const fn = vi.fn().mockResolvedValue(rows)
  return fn as unknown as ReturnType<typeof getDb>
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// jobs
// ---------------------------------------------------------------------------
describe('handleJobTool', () => {
  it('list_jobs returns JSON array', async () => {
    const jobs = [{ id: 'j1', status: 'running' }]
    mockGetDb.mockReturnValue(makeDbMock(jobs))
    const result = await handleJobTool('list_jobs', {})
    expect(result.content[0]?.type).toBe('text')
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '[]')
    expect(Array.isArray(parsed)).toBe(true)
    expect(mockGetDb).toHaveBeenCalledOnce()
  })

  it('list_jobs with status filter calls db', async () => {
    mockGetDb.mockReturnValue(makeDbMock([]))
    await handleJobTool('list_jobs', { status: 'pending' })
    expect(mockGetDb).toHaveBeenCalledOnce()
  })

  it('get_job_output returns lines joined by newline', async () => {
    const outputRows = [
      { line: 'line 3' },
      { line: 'line 2' },
      { line: 'line 1' },
    ]
    mockGetDb.mockReturnValue(makeDbMock(outputRows))
    const result = await handleJobTool('get_job_output', { job_id: 'j1', tail: 3 })
    const text = result.content[0]?.text ?? ''
    // reversed: line 1, line 2, line 3
    expect(text).toContain('line 1')
    expect(text).toContain('line 3')
    expect(text.indexOf('line 1')).toBeLessThan(text.indexOf('line 3'))
  })

  it('get_job_status returns job fields', async () => {
    const row = { status: 'completed', started_at: null, completed_at: null, error: null }
    mockGetDb.mockReturnValue(makeDbMock([row]))
    const result = await handleJobTool('get_job_status', { job_id: 'j1' })
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['status']).toBe('completed')
  })

  it('get_job_status returns error when job not found', async () => {
    mockGetDb.mockReturnValue(makeDbMock([]))
    const result = await handleJobTool('get_job_status', { job_id: 'missing' })
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['error']).toBe('job not found')
  })

  it('spawn_worker inserts job and enqueues task', async () => {
    mockGetDb.mockReturnValue(makeDbMock([]))
    const result = await handleJobTool('spawn_worker', {
      description: 'run tests',
      backend: 'local',
      target: '/tmp/work',
    })
    expect(mockGetDb).toHaveBeenCalledOnce()
    expect(mockEnqueue).toHaveBeenCalledOnce()
    expect(mockEnqueue).toHaveBeenCalledWith(
      'ouro_tasks',
      expect.objectContaining({ backend: 'local', target: '/tmp/work' }),
    )
    expect(mockLog).toHaveBeenCalledOnce()
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect(typeof (parsed as Record<string, unknown>)['job_id']).toBe('string')
  })

  it('spawn_worker uses instructions param when provided', async () => {
    mockGetDb.mockReturnValue(makeDbMock([]))
    await handleJobTool('spawn_worker', {
      description: 'run tests',
      backend: 'git',
      target: 'git@github.com:org/repo',
      instructions: 'Run npm test and report failures',
    })
    expect(mockEnqueue).toHaveBeenCalledWith(
      'ouro_tasks',
      expect.objectContaining({ instructions: 'Run npm test and report failures' }),
    )
  })

  it('cancel_job returns cancelled: true when rows updated', async () => {
    mockGetDb.mockReturnValue(makeDbMock([{ id: 'j1' }]))
    const result = await handleJobTool('cancel_job', { job_id: 'j1' })
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['cancelled']).toBe(true)
  })

  it('cancel_job returns cancelled: false when no rows updated', async () => {
    mockGetDb.mockReturnValue(makeDbMock([]))
    const result = await handleJobTool('cancel_job', { job_id: 'already-done' })
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['cancelled']).toBe(false)
  })

  it('throws on unknown tool name', async () => {
    mockGetDb.mockReturnValue(makeDbMock([]))
    await expect(handleJobTool('nonexistent', {})).rejects.toThrow('Unknown job tool')
  })
})

// ---------------------------------------------------------------------------
// mcp tools (HTTP fetch mocked)
// ---------------------------------------------------------------------------
describe('handleMcpTool', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  it('list_mcps returns JSON array', async () => {
    mockGetDb.mockReturnValue(makeDbMock([{ name: 'corp-db', status: 'operational' }]))
    const result = await handleMcpTool('list_mcps', {})
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '[]')
    expect(Array.isArray(parsed)).toBe(true)
  })

  it('register_mcp POSTs to mcp-factory', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({ success: true, config: {} }),
    })
    const result = await handleMcpTool('register_mcp', {
      name: 'corp-db',
      connection_string: 'postgres://user:pass@localhost/db',
    })
    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/mcp/register')
    expect(opts.method).toBe('POST')
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['success']).toBe(true)
  })

  it('delete_mcp sends DELETE to mcp-factory', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({ success: true }),
    })
    await handleMcpTool('delete_mcp', { name: 'corp-db' })
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/mcp/corp-db')
    expect(opts.method).toBe('DELETE')
  })

  it('test_mcp POSTs to mcp-factory test endpoint', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({ status: 'operational', toolsFound: ['query', 'schema'] }),
    })
    const result = await handleMcpTool('test_mcp', { name: 'corp-db' })
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/mcp/test/corp-db')
    expect(opts.method).toBe('POST')
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['status']).toBe('operational')
  })

  it('throws on unknown tool name', async () => {
    await expect(handleMcpTool('nonexistent', {})).rejects.toThrow('Unknown MCP tool')
  })
})

// ---------------------------------------------------------------------------
// feedback tools
// ---------------------------------------------------------------------------
describe('handleFeedbackTool', () => {
  it('submit_feedback inserts and enqueues', async () => {
    mockGetDb.mockReturnValue(makeDbMock([]))
    const result = await handleFeedbackTool('submit_feedback', { text: 'please add dark mode' })
    expect(mockGetDb).toHaveBeenCalledOnce()
    expect(mockEnqueue).toHaveBeenCalledWith(
      'ouro_feedback',
      expect.objectContaining({ text: 'please add dark mode' }),
    )
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect(typeof (parsed as Record<string, unknown>)['id']).toBe('string')
  })

  it('submit_feedback uses provided source', async () => {
    mockGetDb.mockReturnValue(makeDbMock([]))
    await handleFeedbackTool('submit_feedback', { text: 'test', source: 'telegram' })
    expect(mockEnqueue).toHaveBeenCalledWith(
      'ouro_feedback',
      expect.objectContaining({ source: 'telegram' }),
    )
  })

  it('list_feedback returns JSON array', async () => {
    mockGetDb.mockReturnValue(makeDbMock([{ id: 'f1', status: 'pending' }]))
    const result = await handleFeedbackTool('list_feedback', {})
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '[]')
    expect(Array.isArray(parsed)).toBe(true)
  })

  it('approve_evolution returns approved: true and publishes', async () => {
    mockGetDb.mockReturnValue(makeDbMock([{ id: 'f1' }]))
    const result = await handleFeedbackTool('approve_evolution', { id: 'f1' })
    expect(mockPublish).toHaveBeenCalledWith(
      'ouro_notify',
      expect.objectContaining({ type: 'evolution_approved', feedbackId: 'f1' }),
    )
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['approved']).toBe(true)
  })

  it('approve_evolution returns approved: false when pr_open check fails', async () => {
    mockGetDb.mockReturnValue(makeDbMock([]))
    const result = await handleFeedbackTool('approve_evolution', { id: 'f1' })
    expect(mockPublish).not.toHaveBeenCalled()
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['approved']).toBe(false)
  })

  it('reject_evolution returns rejected: true', async () => {
    mockGetDb.mockReturnValue(makeDbMock([{ id: 'f1' }]))
    const result = await handleFeedbackTool('reject_evolution', { id: 'f1', reason: 'bad idea' })
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['rejected']).toBe(true)
  })

  it('merge_evolution merges PR and sets status to applied', async () => {
    const row = { pr_url: 'https://github.com/org/repo/pull/42', status: 'merge_ready' }
    mockGetDb
      .mockReturnValueOnce(makeDbMock([row]))   // SELECT
      .mockReturnValueOnce(makeDbMock([]))       // UPDATE
    mockSpawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '', output: [], pid: 1, signal: null, error: undefined })
    const result = await handleFeedbackTool('merge_evolution', { id: 'f1' })
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'gh',
      ['pr', 'merge', '--squash', 'https://github.com/org/repo/pull/42'],
      expect.objectContaining({ encoding: 'utf8' }),
    )
    expect(mockPublish).toHaveBeenCalledWith(
      'ouro_notify',
      expect.objectContaining({ type: 'evolution_applied', feedbackId: 'f1' }),
    )
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['merged']).toBe(true)
  })

  it('merge_evolution returns error when feedback not found', async () => {
    mockGetDb.mockReturnValue(makeDbMock([]))
    const result = await handleFeedbackTool('merge_evolution', { id: 'missing' })
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['error']).toContain('not found')
  })

  it('merge_evolution returns error when status is not merge_ready or approved', async () => {
    mockGetDb.mockReturnValue(makeDbMock([{ pr_url: 'https://github.com/org/repo/pull/1', status: 'pending' }]))
    const result = await handleFeedbackTool('merge_evolution', { id: 'f1' })
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['error']).toContain('pending')
  })

  it('merge_evolution returns merged: false on gh failure', async () => {
    const row = { pr_url: 'https://github.com/org/repo/pull/99', status: 'approved' }
    mockGetDb.mockReturnValue(makeDbMock([row]))
    mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: 'not authorized', output: [], pid: 1, signal: null, error: undefined })
    const result = await handleFeedbackTool('merge_evolution', { id: 'f1' })
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['merged']).toBe(false)
  })

  it('throws on unknown tool name', async () => {
    await expect(handleFeedbackTool('nonexistent', {})).rejects.toThrow('Unknown feedback tool')
  })
})

// ---------------------------------------------------------------------------
// log tool
// ---------------------------------------------------------------------------
describe('handleLogTool', () => {
  it('get_logs returns formatted lines in chronological order', async () => {
    const rows = [
      { source: 'meta-agent', message: 'tick 3', ts: new Date('2024-01-01T00:00:03Z') },
      { source: 'worker', message: 'tick 2', ts: new Date('2024-01-01T00:00:02Z') },
      { source: 'meta-agent', message: 'tick 1', ts: new Date('2024-01-01T00:00:01Z') },
    ]
    mockGetDb.mockReturnValue(makeDbMock(rows))
    const result = await handleLogTool('get_logs', { limit: 3 })
    const text = result.content[0]?.text ?? ''
    // reversed to chronological: tick 1, tick 2, tick 3
    expect(text).toContain('[meta-agent] tick 1')
    expect(text).toContain('[worker] tick 2')
    expect(text.indexOf('tick 1')).toBeLessThan(text.indexOf('tick 3'))
  })

  it('get_logs with no args uses defaults', async () => {
    mockGetDb.mockReturnValue(makeDbMock([]))
    const result = await handleLogTool('get_logs', undefined)
    expect(result.content[0]?.type).toBe('text')
    expect(mockGetDb).toHaveBeenCalledOnce()
  })

  it('throws on unknown tool name', async () => {
    await expect(handleLogTool('nonexistent', {})).rejects.toThrow('Unknown log tool')
  })
})
