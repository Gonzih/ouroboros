import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@ouroboros/core', () => ({
  log: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../claude.js', () => ({
  findClaudeBin: vi.fn().mockReturnValue('claude'),
}))

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

import { spawn } from 'node:child_process'
import { buildCoordinatorPrompt, spawnCoordinator } from '../coordinator.js'

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
    })

    it('is under 200 words', () => {
      const prompt = buildCoordinatorPrompt()
      const wordCount = prompt.trim().split(/\s+/).length
      expect(wordCount).toBeLessThan(200)
    })

    it('does not contain gh pr merge', () => {
      const prompt = buildCoordinatorPrompt()
      expect(prompt).not.toContain('gh pr merge')
    })
  })

  describe('spawnCoordinator', () => {
    it('always passes --dangerously-skip-permissions', async () => {
      await spawnCoordinator()
      const call = mockSpawn.mock.calls[0]
      expect(call).toBeDefined()
      const args = call![1] as string[]
      expect(args).toContain('--dangerously-skip-permissions')
    })

    it('always passes --print for non-interactive subprocess behavior', async () => {
      await spawnCoordinator()
      const call = mockSpawn.mock.calls[0]
      expect(call).toBeDefined()
      const args = call![1] as string[]
      expect(args).toContain('--print')
    })

    it('does not use --continue or --resume (stateless)', async () => {
      await spawnCoordinator()
      const call = mockSpawn.mock.calls[0]
      expect(call).toBeDefined()
      const args = call![1] as string[]
      expect(args).not.toContain('--continue')
      expect(args).not.toContain('--resume')
    })

    it('always passes the coordinator prompt via -p flag', async () => {
      await spawnCoordinator()
      const call = mockSpawn.mock.calls[0]
      expect(call).toBeDefined()
      const args = call![1] as string[]
      const promptIdx = args.indexOf('-p')
      expect(promptIdx).toBeGreaterThan(-1)
      const prompt = args[promptIdx + 1] ?? ''
      expect(prompt).toContain('Ouroboros coordinator')
    })

    it('passes --mcp-config pointing to claude-control.json', async () => {
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
      const fakeProc = makeFakeProc()
      mockSpawn.mockReturnValueOnce(fakeProc as unknown as ReturnType<typeof spawn>)
      const proc = await spawnCoordinator()
      expect(proc).toBe(fakeProc)
    })
  })
})
