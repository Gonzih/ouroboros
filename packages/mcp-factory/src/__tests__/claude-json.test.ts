import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Must mock before importing the module under test
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  existsSync: vi.fn(),
}))

import * as fs from 'node:fs'
import { patchClaudeJson, removeFromClaudeJson } from '../claude-json.js'

const mockedFs = vi.mocked(fs)

describe('claude-json helpers', () => {
  const REPO_ROOT = '/tmp/test-repo'
  const FILE_PATH = '/tmp/test-claude.json'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env['OURO_REPO_ROOT'] = REPO_ROOT
  })

  afterEach(() => {
    delete process.env['OURO_REPO_ROOT']
  })

  describe('patchClaudeJson', () => {
    it('creates nested structure when file does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false)
      let written = ''
      mockedFs.writeFileSync.mockImplementation((_p, data) => { written = data as string })
      mockedFs.renameSync.mockImplementation(() => undefined)

      patchClaudeJson('my-db', { command: 'npx', args: ['test'] }, FILE_PATH)

      const parsed: unknown = JSON.parse(written)
      expect(parsed).toMatchObject({
        projects: {
          [REPO_ROOT]: {
            mcpServers: {
              'my-db': { command: 'npx', args: ['test'] }
            }
          }
        }
      })
    })

    it('merges into existing file structure', () => {
      const existing = {
        projects: {
          [REPO_ROOT]: {
            mcpServers: { 'existing-db': { command: 'npx', args: ['existing'] } }
          }
        }
      }
      mockedFs.existsSync.mockReturnValue(true)
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(existing))
      let written = ''
      mockedFs.writeFileSync.mockImplementation((_p, data) => { written = data as string })
      mockedFs.renameSync.mockImplementation(() => undefined)

      patchClaudeJson('new-db', { command: 'npx', args: ['new'] }, FILE_PATH)

      const parsed = JSON.parse(written) as { projects: Record<string, { mcpServers: Record<string, unknown> }> }
      expect(Object.keys(parsed.projects[REPO_ROOT]!.mcpServers)).toContain('existing-db')
      expect(Object.keys(parsed.projects[REPO_ROOT]!.mcpServers)).toContain('new-db')
    })

    it('throws when OURO_REPO_ROOT is not set', () => {
      delete process.env['OURO_REPO_ROOT']
      mockedFs.existsSync.mockReturnValue(false)
      expect(() => patchClaudeJson('test', { command: 'npx', args: [] }, FILE_PATH))
        .toThrow('OURO_REPO_ROOT')
    })
  })

  describe('removeFromClaudeJson', () => {
    it('removes the named MCP entry', () => {
      const existing = {
        projects: {
          [REPO_ROOT]: {
            mcpServers: {
              'my-db': { command: 'npx', args: ['test'] },
              'other-db': { command: 'npx', args: ['other'] }
            }
          }
        }
      }
      mockedFs.existsSync.mockReturnValue(true)
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(existing))
      let written = ''
      mockedFs.writeFileSync.mockImplementation((_p, data) => { written = data as string })
      mockedFs.renameSync.mockImplementation(() => undefined)

      removeFromClaudeJson('my-db', FILE_PATH)

      const parsed = JSON.parse(written) as { projects: Record<string, { mcpServers: Record<string, unknown> }> }
      expect(Object.keys(parsed.projects[REPO_ROOT]!.mcpServers)).not.toContain('my-db')
      expect(Object.keys(parsed.projects[REPO_ROOT]!.mcpServers)).toContain('other-db')
    })

    it('does nothing when file does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false)
      // Should not throw even though structure is empty
      removeFromClaudeJson('my-db', FILE_PATH)
      expect(mockedFs.writeFileSync).not.toHaveBeenCalled()
    })
  })
})
