import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

vi.mock('@ouroboros/core', () => ({
  log: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../claude.js', () => ({
  findClaudeBin: vi.fn().mockReturnValue('claude'),
}))

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { loadSessionId, saveSessionId, buildCoordinatorPrompt, spawnCoordinator } from '../coordinator.js'

const mockExists = vi.mocked(existsSync)
const mockReadFile = vi.mocked(readFileSync)
const mockWriteFile = vi.mocked(writeFileSync)
const mockSpawn = vi.mocked(spawn)

function makeFakeProc() {
  return {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    once: vi.fn(),
    on: vi.fn(),
    pid: 12345,
  }
}

describe('coordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSpawn.mockReturnValue(makeFakeProc() as unknown as ReturnType<typeof spawn>)
  })

  describe('loadSessionId', () => {
    it('returns undefined when session file does not exist', () => {
      mockExists.mockReturnValue(false)
      expect(loadSessionId()).toBeUndefined()
    })

    it('returns undefined when session file is empty', () => {
      mockExists.mockReturnValue(true)
      mockReadFile.mockReturnValue('' as unknown as ReturnType<typeof readFileSync>)
      expect(loadSessionId()).toBeUndefined()
    })

    it('returns undefined when session file contains only whitespace', () => {
      mockExists.mockReturnValue(true)
      mockReadFile.mockReturnValue('   \n' as unknown as ReturnType<typeof readFileSync>)
      expect(loadSessionId()).toBeUndefined()
    })

    it('returns trimmed content when file has a session ID', () => {
      mockExists.mockReturnValue(true)
      mockReadFile.mockReturnValue('abc-123-session\n' as unknown as ReturnType<typeof readFileSync>)
      expect(loadSessionId()).toBe('abc-123-session')
    })

    it('returns content as-is when already trimmed', () => {
      mockExists.mockReturnValue(true)
      mockReadFile.mockReturnValue('started' as unknown as ReturnType<typeof readFileSync>)
      expect(loadSessionId()).toBe('started')
    })
  })

  describe('saveSessionId', () => {
    it('writes the session ID to the .ouro-session file', () => {
      saveSessionId('my-session-id')
      expect(mockWriteFile).toHaveBeenCalledOnce()
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('.ouro-session'),
        'my-session-id',
      )
    })

    it('uses OURO_REPO_ROOT env var in the file path', () => {
      const savedRoot = process.env['OURO_REPO_ROOT']
      process.env['OURO_REPO_ROOT'] = '/my/repo'
      saveSessionId('test-id')
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('/my/repo'),
        'test-id',
      )
      if (savedRoot === undefined) delete process.env['OURO_REPO_ROOT']
      else process.env['OURO_REPO_ROOT'] = savedRoot
    })
  })

  describe('buildCoordinatorPrompt', () => {
    it('returns a non-empty string', () => {
      const prompt = buildCoordinatorPrompt()
      expect(typeof prompt).toBe('string')
      expect(prompt.length).toBeGreaterThan(0)
    })

    it('mentions the coordinator role', () => {
      const prompt = buildCoordinatorPrompt()
      expect(prompt).toContain('Ouroboros coordinator')
    })

    it('references key MCP tool names for worker management', () => {
      const prompt = buildCoordinatorPrompt()
      expect(prompt).toContain('list_jobs')
      expect(prompt).toContain('spawn_worker')
      expect(prompt).toContain('get_job_status')
      expect(prompt).toContain('get_job_output')
      expect(prompt).toContain('cancel_job')
    })

    it('references diagnostic tools', () => {
      const prompt = buildCoordinatorPrompt()
      expect(prompt).toContain('get_logs')
    })

    it('references evolution/feedback tools', () => {
      const prompt = buildCoordinatorPrompt()
      expect(prompt).toContain('approve_evolution')
      expect(prompt).toContain('reject_evolution')
    })

    it('references MCP awareness tools', () => {
      const prompt = buildCoordinatorPrompt()
      expect(prompt).toContain('list_mcps')
      expect(prompt).toContain('register_mcp')
      expect(prompt).toContain('test_mcp')
      expect(prompt).toContain('delete_mcp')
    })

    it('mentions current version and --continue persistence', () => {
      const prompt = buildCoordinatorPrompt()
      expect(prompt).toContain('v1.3.0')
      expect(prompt).toContain('--continue')
    })

    it('instructs coordinator to run gh pr merge after approving', () => {
      const prompt = buildCoordinatorPrompt()
      expect(prompt).toContain('gh pr merge')
    })

    it('instructs coordinator to handle merge_failed items', () => {
      const prompt = buildCoordinatorPrompt()
      expect(prompt).toContain('merge_failed')
    })
  })

  describe('spawnCoordinator', () => {
    it('always passes --dangerously-skip-permissions', async () => {
      mockExists.mockReturnValue(false)
      await spawnCoordinator()
      const call = mockSpawn.mock.calls[0]
      expect(call).toBeDefined()
      const args = call![1] as string[]
      expect(args).toContain('--dangerously-skip-permissions')
    })

    it('always passes --print for non-interactive subprocess behavior', async () => {
      mockExists.mockReturnValue(false)
      await spawnCoordinator()
      const call = mockSpawn.mock.calls[0]
      expect(call).toBeDefined()
      const args = call![1] as string[]
      expect(args).toContain('--print')
    })

    it('does not use --continue on first start (no session file)', async () => {
      mockExists.mockReturnValue(false)
      await spawnCoordinator()
      const call = mockSpawn.mock.calls[0]
      expect(call).toBeDefined()
      const args = call![1] as string[]
      expect(args).not.toContain('--continue')
    })

    it('uses --continue when session file exists', async () => {
      mockExists.mockReturnValue(true)
      mockReadFile.mockReturnValue('existing-session' as unknown as ReturnType<typeof readFileSync>)
      await spawnCoordinator()
      const call = mockSpawn.mock.calls[0]
      expect(call).toBeDefined()
      const args = call![1] as string[]
      expect(args).toContain('--continue')
    })

    it('passes the coordinator prompt on first start', async () => {
      mockExists.mockReturnValue(false)
      await spawnCoordinator()
      const call = mockSpawn.mock.calls[0]
      expect(call).toBeDefined()
      const args = call![1] as string[]
      const promptIdx = args.indexOf('-p')
      expect(promptIdx).toBeGreaterThan(-1)
      const prompt = args[promptIdx + 1] ?? ''
      expect(prompt).toContain('Ouroboros coordinator')
    })

    it('saves a session marker on first start', async () => {
      mockExists.mockReturnValue(false)
      await spawnCoordinator()
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('.ouro-session'),
        expect.any(String),
      )
    })

    it('does not overwrite session file when session already exists', async () => {
      mockExists.mockReturnValue(true)
      mockReadFile.mockReturnValue('my-session' as unknown as ReturnType<typeof readFileSync>)
      await spawnCoordinator()
      // saveSessionId only called if !sessionId — when session exists, no write
      expect(mockWriteFile).not.toHaveBeenCalled()
    })

    it('passes --mcp-config pointing to claude-control.json', async () => {
      mockExists.mockReturnValue(false)
      await spawnCoordinator()
      const call = mockSpawn.mock.calls[0]
      expect(call).toBeDefined()
      const args = call![1] as string[]
      const mcpIdx = args.indexOf('--mcp-config')
      expect(mcpIdx).toBeGreaterThan(-1)
      const configPath = args[mcpIdx + 1] ?? ''
      expect(configPath).toContain('claude-control.json')
    })

    it('returns the spawned ChildProcess', async () => {
      mockExists.mockReturnValue(false)
      const fakeProc = makeFakeProc()
      mockSpawn.mockReturnValueOnce(fakeProc as unknown as ReturnType<typeof spawn>)
      const proc = await spawnCoordinator()
      expect(proc).toBe(fakeProc)
    })
  })
})
