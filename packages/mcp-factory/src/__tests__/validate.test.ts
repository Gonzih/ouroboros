import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}))

vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  renameSync: vi.fn(),
}))

import { spawnSync } from 'node:child_process'
import { validateMcp } from '../validate.js'

const mockSpawn = vi.mocked(spawnSync)

function makeSpawnResult(stdout: string, opts?: { error?: Error }) {
  return {
    stdout,
    stderr: '',
    status: 0,
    pid: 999,
    output: ['', stdout, ''],
    signal: null,
    error: opts?.error,
  }
}

describe('validateMcp', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns operational when OPERATIONAL marker found at end', async () => {
    mockSpawn.mockReturnValue(makeSpawnResult('All tools work fine.\nOPERATIONAL') as ReturnType<typeof spawnSync>)
    const result = await validateMcp('test', { command: 'npx', args: ['test'] }, 'pg')
    expect(result.status).toBe('operational')
  })

  it('returns partial when PARTIAL marker found', async () => {
    mockSpawn.mockReturnValue(makeSpawnResult('Some tools worked.\nPARTIAL') as ReturnType<typeof spawnSync>)
    const result = await validateMcp('test', { command: 'npx', args: ['test'] }, 'pg')
    expect(result.status).toBe('partial')
  })

  it('returns failed when FAILED marker found', async () => {
    mockSpawn.mockReturnValue(makeSpawnResult('Could not connect.\nFAILED') as ReturnType<typeof spawnSync>)
    const result = await validateMcp('test', { command: 'npx', args: ['test'] }, 'pg')
    expect(result.status).toBe('failed')
  })

  it('returns failed when no marker found', async () => {
    mockSpawn.mockReturnValue(makeSpawnResult('Some output with no marker') as ReturnType<typeof spawnSync>)
    const result = await validateMcp('test', { command: 'npx', args: ['test'] })
    expect(result.status).toBe('failed')
  })

  it('returns failed when spawnSync throws an error', async () => {
    mockSpawn.mockReturnValue(makeSpawnResult('', { error: new Error('ENOENT claude') }) as ReturnType<typeof spawnSync>)
    const result = await validateMcp('test', { command: 'npx', args: ['test'] }, 'pg')
    expect(result.status).toBe('failed')
    expect(result.log).toContain('Spawn error')
  })

  it('extracts tool names from backtick-quoted identifiers in output', async () => {
    const output = 'Found tools: `query_database`, `list_tables`\nOPERATIONAL'
    mockSpawn.mockReturnValue(makeSpawnResult(output) as ReturnType<typeof spawnSync>)
    const result = await validateMcp('test', { command: 'npx', args: ['test'] }, 'pg')
    expect(result.toolsFound).toContain('query_database')
    expect(result.toolsFound).toContain('list_tables')
  })

  it('includes duration in result', async () => {
    mockSpawn.mockReturnValue(makeSpawnResult('OPERATIONAL') as ReturnType<typeof spawnSync>)
    const result = await validateMcp('test', { command: 'npx', args: ['test'] })
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('uses fetch-specific prompt for http scheme', async () => {
    mockSpawn.mockReturnValue(makeSpawnResult('OPERATIONAL') as ReturnType<typeof spawnSync>)
    await validateMcp('test', { command: 'npx', args: ['test'] }, 'http')
    const callArgs = mockSpawn.mock.calls[0]!
    const promptArg = callArgs[1] as string[]
    const prompt = promptArg[promptArg.indexOf('-p') + 1]!
    expect(prompt).toContain('fetch')
  })

  it('uses fetch-specific prompt for https scheme', async () => {
    mockSpawn.mockReturnValue(makeSpawnResult('OPERATIONAL') as ReturnType<typeof spawnSync>)
    await validateMcp('test', { command: 'npx', args: ['test'] }, 'https')
    const callArgs = mockSpawn.mock.calls[0]!
    const promptArg = callArgs[1] as string[]
    const prompt = promptArg[promptArg.indexOf('-p') + 1]!
    expect(prompt).toContain('fetch')
  })
})
