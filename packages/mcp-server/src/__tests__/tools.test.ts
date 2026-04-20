import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@ouroboros/core', () => ({
  getDb: vi.fn(),
  log: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(undefined),
  enqueue: vi.fn().mockResolvedValue(BigInt(1)),
}))

vi.mock('croner', () => ({
  Cron: vi.fn().mockImplementation((expr: string) => {
    if (expr === 'INVALID') throw new Error('invalid cron')
    return { nextRun: () => new Date('2026-04-17T09:00:00Z') }
  }),
}))

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}))

import { getDb, log, publish, enqueue } from '@ouroboros/core'
import { spawnSync } from 'node:child_process'
import { handleJobTool, checkAtomicity } from '../tools/jobs.js'
import { handleMcpTool } from '../tools/mcp.js'
import { handleFeedbackTool } from '../tools/feedback.js'
import { handleLogTool } from '../tools/logs.js'
import { handleScheduleTool } from '../tools/schedules.js'

const mockGetDb = vi.mocked(getDb)
const mockLog = vi.mocked(log)
const mockPublish = vi.mocked(publish)
const mockEnqueue = vi.mocked(enqueue)
const mockSpawnSync = vi.mocked(spawnSync)

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

  it('list_jobs with offset returns JSON array', async () => {
    const jobs = [{ id: 'j5', status: 'completed' }]
    mockGetDb.mockReturnValue(makeDbMock(jobs))
    const result = await handleJobTool('list_jobs', { limit: 10, offset: 20 })
    expect(result.content[0]?.type).toBe('text')
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '[]')
    expect(Array.isArray(parsed)).toBe(true)
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
    const row = { status: 'completed', started_at: null, completed_at: null, error: null, atomicity_warning: null }
    mockGetDb.mockReturnValue(makeDbMock([row]))
    const result = await handleJobTool('get_job_status', { job_id: 'j1' })
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['status']).toBe('completed')
  })

  it('get_job_status includes atomicity_warning in response', async () => {
    const row = {
      status: 'pending',
      started_at: null,
      completed_at: null,
      error: null,
      atomicity_warning: 'Task may be compound — consider splitting with split_task',
    }
    mockGetDb.mockReturnValue(makeDbMock([row]))
    const result = await handleJobTool('get_job_status', { job_id: 'j1' })
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
    expect(parsed['atomicity_warning']).toBeTruthy()
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

  it('cancel_job cancels pending job immediately', async () => {
    // First query (pending UPDATE) returns a row → returns early
    const fn = vi.fn().mockResolvedValueOnce([{ id: 'j1' }])
    mockGetDb.mockReturnValue(fn as unknown as ReturnType<typeof getDb>)
    const result = await handleJobTool('cancel_job', { job_id: 'j1' })
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['cancelled']).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('cancel_job sets cancellation_requested for running job', async () => {
    // First query (pending UPDATE) returns nothing; second (running UPDATE) returns row
    const fn = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'j2' }])
    mockGetDb.mockReturnValue(fn as unknown as ReturnType<typeof getDb>)
    const result = await handleJobTool('cancel_job', { job_id: 'j2' })
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['cancelled']).toBe(true)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('cancel_job returns cancelled: false for terminal jobs', async () => {
    // Both queries return nothing
    const fn = vi.fn().mockResolvedValue([])
    mockGetDb.mockReturnValue(fn as unknown as ReturnType<typeof getDb>)
    const result = await handleJobTool('cancel_job', { job_id: 'already-done' })
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['cancelled']).toBe(false)
  })

  it('retry_job creates a new pending job from a failed one', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce([{ description: 'run tests', backend: 'local', target: '/tmp', status: 'failed', instructions: 'detailed instructions' }])
      .mockResolvedValueOnce([]) // INSERT
    mockGetDb.mockReturnValue(fn as unknown as ReturnType<typeof getDb>)
    const result = await handleJobTool('retry_job', { job_id: 'j-failed' })
    expect(mockEnqueue).toHaveBeenCalledWith(
      'ouro_tasks',
      expect.objectContaining({ backend: 'local', target: '/tmp', instructions: 'detailed instructions' }),
    )
    expect(mockLog).toHaveBeenCalledOnce()
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect(typeof (parsed as Record<string, unknown>)['job_id']).toBe('string')
  })

  it('retry_job falls back to description when instructions is null', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce([{ description: 'run tests', backend: 'local', target: '/tmp', status: 'cancelled', instructions: null }])
      .mockResolvedValueOnce([])
    mockGetDb.mockReturnValue(fn as unknown as ReturnType<typeof getDb>)
    await handleJobTool('retry_job', { job_id: 'j-cancelled' })
    expect(mockEnqueue).toHaveBeenCalledWith(
      'ouro_tasks',
      expect.objectContaining({ instructions: 'run tests' }),
    )
  })

  it('retry_job returns error when job not found', async () => {
    mockGetDb.mockReturnValue(makeDbMock([]))
    const result = await handleJobTool('retry_job', { job_id: 'missing' })
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['error']).toBe('job not found')
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('retry_job returns error for non-retryable job status', async () => {
    mockGetDb.mockReturnValue(makeDbMock([{ description: 'run tests', backend: 'local', target: '/tmp', status: 'running', instructions: null }]))
    const result = await handleJobTool('retry_job', { job_id: 'j-running' })
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['error']).toMatch(/only retry failed or cancelled/)
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('throws on unknown tool name', async () => {
    mockGetDb.mockReturnValue(makeDbMock([]))
    await expect(handleJobTool('nonexistent', {})).rejects.toThrow('Unknown job tool')
  })
})

// ---------------------------------------------------------------------------
// checkAtomicity
// ---------------------------------------------------------------------------
describe('checkAtomicity', () => {
  it('returns undefined for a short single-concern task', () => {
    expect(checkAtomicity('Add a dark mode toggle to the settings page.')).toBeUndefined()
  })

  it('triggers warning when task has more than 5 sentences', () => {
    const task = 'Do step one. Do step two. Do step three. Do step four. Do step five. Do step six.'
    expect(checkAtomicity(task)).toMatch(/compound/)
  })

  it('triggers warning when task has more than 2 compound indicators', () => {
    const task = 'Add a feature, additionally update the docs, furthermore write tests, and also fix the lint.'
    expect(checkAtomicity(task)).toMatch(/compound/)
  })

  it('triggers warning when task has more than 3 numbered list items', () => {
    const task = 'Do:\n1. thing one\n2. thing two\n3. thing three\n4. thing four'
    expect(checkAtomicity(task)).toMatch(/compound/)
  })

  it('does not trigger on exactly 3 numbered items', () => {
    const task = 'Do:\n1. thing one\n2. thing two\n3. thing three'
    expect(checkAtomicity(task)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// split_task
// ---------------------------------------------------------------------------
describe('split_task via handleJobTool', () => {
  it('returns subtasks from a compound task', async () => {
    const subtasks = [
      { title: 'Add API endpoint', description: 'Create GET /users', estimated_complexity: 'small' },
      { title: 'Add tests', description: 'Write unit tests for GET /users', estimated_complexity: 'small' },
    ]
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ subtasks }),
      stderr: '',
      error: undefined,
      pid: 1234,
      output: [],
      signal: null,
    })

    const result = await handleJobTool('split_task', {
      task: 'Add a user API endpoint and write tests for it and add docs',
      repo_url: 'https://github.com/org/repo',
    })
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as { subtasks: unknown[] }
    expect(Array.isArray(parsed.subtasks)).toBe(true)
    expect(parsed.subtasks.length).toBeGreaterThanOrEqual(2)
  })

  it('returns error when claude fails', async () => {
    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'command not found',
      error: undefined,
      pid: 0,
      output: [],
      signal: null,
    })

    const result = await handleJobTool('split_task', {
      task: 'do something',
      repo_url: 'https://github.com/org/repo',
    })
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
    expect(parsed['error']).toBeTruthy()
  })

  it('extracts JSON when claude wraps output in prose', async () => {
    const subtasks = [{ title: 'A', description: 'Do A', estimated_complexity: 'trivial' }]
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: `Here are the subtasks:\n\n${JSON.stringify({ subtasks })}\n\nLet me know if you need more.`,
      stderr: '',
      error: undefined,
      pid: 1234,
      output: [],
      signal: null,
    })

    const result = await handleJobTool('split_task', {
      task: 'do a thing',
      repo_url: 'https://github.com/org/repo',
    })
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as { subtasks: unknown[] }
    expect(Array.isArray(parsed.subtasks)).toBe(true)
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

  it('approve_evolution retries a merge_failed item', async () => {
    mockGetDb.mockReturnValue(makeDbMock([{ id: 'f1' }]))
    const result = await handleFeedbackTool('approve_evolution', { id: 'f1' })
    expect(mockPublish).toHaveBeenCalledWith(
      'ouro_notify',
      expect.objectContaining({ type: 'evolution_approved', feedbackId: 'f1' }),
    )
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['approved']).toBe(true)
  })

  it('list_feedback with merge_failed status calls db', async () => {
    mockGetDb.mockReturnValue(makeDbMock([{ id: 'f1', status: 'merge_failed' }]))
    const result = await handleFeedbackTool('list_feedback', { status: 'merge_failed' })
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '[]')
    expect(Array.isArray(parsed)).toBe(true)
    expect(mockGetDb).toHaveBeenCalledOnce()
  })

  it('reject_evolution returns rejected: true', async () => {
    mockGetDb.mockReturnValue(makeDbMock([{ id: 'f1' }]))
    const result = await handleFeedbackTool('reject_evolution', { id: 'f1', reason: 'bad idea' })
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['rejected']).toBe(true)
  })

  it('throws on unknown tool name', async () => {
    await expect(handleFeedbackTool('nonexistent', {})).rejects.toThrow('Unknown feedback tool')
  })
})

// ---------------------------------------------------------------------------
// log tool
// ---------------------------------------------------------------------------
describe('handleLogTool', () => {
  function makeHealthAndLogsMock(
    health: Record<string, unknown>,
    logRows: unknown[],
  ): ReturnType<typeof getDb> {
    const fn = vi.fn()
      .mockResolvedValueOnce([health])
      .mockResolvedValueOnce(logRows)
    return fn as unknown as ReturnType<typeof getDb>
  }

  it('get_logs returns health object with correct running job count', async () => {
    const logRows = [
      { source: 'meta-agent', message: 'tick 3', ts: new Date('2024-01-01T00:00:03Z') },
      { source: 'worker', message: 'tick 2', ts: new Date('2024-01-01T00:00:02Z') },
      { source: 'meta-agent', message: 'tick 1', ts: new Date('2024-01-01T00:00:01Z') },
    ]
    mockGetDb.mockReturnValue(
      makeHealthAndLogsMock({ running: 2, stalled: 0, failed_1h: 1, pending: 3, avg_min: 5.5 }, logRows),
    )
    const result = await handleLogTool('get_logs', { limit: 3 })
    const text = result.content[0]?.text ?? ''
    const parsed = JSON.parse(text) as { health: Record<string, unknown>; logs: string[] }
    expect(parsed.health.runningJobs).toBe(2)
    expect(parsed.health.pendingJobs).toBe(3)
    expect(parsed.health.failedLast1h).toBe(1)
    expect(Array.isArray(parsed.logs)).toBe(true)
    // reversed to chronological: tick 1, tick 2, tick 3
    const logsText = parsed.logs.join('\n')
    expect(logsText).toContain('[meta-agent] tick 1')
    expect(logsText).toContain('[worker] tick 2')
    expect(logsText.indexOf('tick 1')).toBeLessThan(logsText.indexOf('tick 3'))
  })

  it('get_logs with no args uses defaults and returns health', async () => {
    mockGetDb.mockReturnValue(
      makeHealthAndLogsMock({ running: 0, stalled: 0, failed_1h: 0, pending: 0, avg_min: null }, []),
    )
    const result = await handleLogTool('get_logs', undefined)
    expect(result.content[0]?.type).toBe('text')
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
    expect(parsed['health']).toBeDefined()
    expect(parsed['logs']).toBeDefined()
    expect(mockGetDb).toHaveBeenCalledOnce()
  })

  it('topErrors contains error log lines', async () => {
    const logRows = [
      { source: 'worker', message: 'job failed: timeout', ts: new Date() },
      { source: 'meta-agent', message: 'normal tick', ts: new Date() },
      { source: 'worker', message: 'Error: connection refused', ts: new Date() },
    ]
    mockGetDb.mockReturnValue(
      makeHealthAndLogsMock({ running: 0, stalled: 0, failed_1h: 2, pending: 0, avg_min: null }, logRows),
    )
    const result = await handleLogTool('get_logs', {})
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as { health: { topErrors: string[] } }
    expect(parsed.health.topErrors.length).toBeGreaterThanOrEqual(1)
    expect(parsed.health.topErrors.some((e: string) => /failed|Error/i.test(e))).toBe(true)
  })

  it('throws on unknown tool name', async () => {
    await expect(handleLogTool('nonexistent', {})).rejects.toThrow('Unknown log tool')
  })
})

// ---------------------------------------------------------------------------
// schedule tools
// ---------------------------------------------------------------------------
describe('handleScheduleTool', () => {
  it('list_schedules returns JSON array', async () => {
    const schedules = [{ id: 's1', name: 'daily', cron_expr: '0 9 * * *', enabled: true }]
    mockGetDb.mockReturnValue(makeDbMock(schedules))
    const result = await handleScheduleTool('list_schedules', {})
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '[]')
    expect(Array.isArray(parsed)).toBe(true)
    expect((parsed as Array<Record<string, unknown>>)[0]?.['name']).toBe('daily')
  })

  it('create_schedule inserts and returns id', async () => {
    mockGetDb.mockReturnValue(makeDbMock([]))
    const result = await handleScheduleTool('create_schedule', {
      name: 'daily-report',
      cron_expr: '0 9 * * *',
      backend: 'local',
      target: '/tmp/work',
      instructions: 'Generate daily report',
    })
    expect(mockGetDb).toHaveBeenCalledOnce()
    expect(mockLog).toHaveBeenCalledOnce()
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect(typeof (parsed as Record<string, unknown>)['id']).toBe('string')
  })

  it('create_schedule returns error for invalid cron expression', async () => {
    const result = await handleScheduleTool('create_schedule', {
      name: 'bad',
      cron_expr: 'INVALID',
      backend: 'local',
      target: '/tmp/work',
      instructions: 'do something',
    })
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['error']).toMatch(/invalid cron/)
  })

  it('toggle_schedule flips enabled and returns new state', async () => {
    mockGetDb.mockReturnValue(makeDbMock([{ id: 's1', enabled: false }]))
    const result = await handleScheduleTool('toggle_schedule', { id: 's1' })
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['enabled']).toBe(false)
  })

  it('toggle_schedule returns error when not found', async () => {
    mockGetDb.mockReturnValue(makeDbMock([]))
    const result = await handleScheduleTool('toggle_schedule', { id: 'missing' })
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['error']).toBe('schedule not found')
  })

  it('delete_schedule returns deleted: true', async () => {
    mockGetDb.mockReturnValue(makeDbMock([{ id: 's1' }]))
    const result = await handleScheduleTool('delete_schedule', { id: 's1' })
    expect(mockLog).toHaveBeenCalledOnce()
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['deleted']).toBe(true)
  })

  it('delete_schedule returns error when not found', async () => {
    mockGetDb.mockReturnValue(makeDbMock([]))
    const result = await handleScheduleTool('delete_schedule', { id: 'missing' })
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['error']).toBe('schedule not found')
  })

  it('update_schedule returns updated: true when found', async () => {
    mockGetDb.mockReturnValue(makeDbMock([{ id: 's1' }]))
    const result = await handleScheduleTool('update_schedule', {
      id: 's1',
      instructions: 'Generate weekly report instead',
    })
    expect(mockLog).toHaveBeenCalledOnce()
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['updated']).toBe(true)
  })

  it('update_schedule recomputes next_run_at when cron_expr changes', async () => {
    mockGetDb.mockReturnValue(makeDbMock([{ id: 's1' }]))
    const result = await handleScheduleTool('update_schedule', {
      id: 's1',
      cron_expr: '0 9 * * *',
    })
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['updated']).toBe(true)
  })

  it('update_schedule returns error for invalid cron expression', async () => {
    const result = await handleScheduleTool('update_schedule', {
      id: 's1',
      cron_expr: 'INVALID',
    })
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['error']).toMatch(/invalid cron/)
  })

  it('update_schedule returns error when not found', async () => {
    mockGetDb.mockReturnValue(makeDbMock([]))
    const result = await handleScheduleTool('update_schedule', { id: 'missing', name: 'new-name' })
    const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
    expect((parsed as Record<string, unknown>)['error']).toBe('schedule not found')
  })

  it('throws on unknown tool name', async () => {
    await expect(handleScheduleTool('nonexistent', {})).rejects.toThrow('Unknown schedule tool')
  })
})
