import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { patchClaudeJson, removeFromClaudeJson } from '../claude-json.js'

function makeTempFile(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ouro-claude-json-test-'))
  const file = join(dir, '.claude.json')
  return { dir, file }
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'))
}

test('patchClaudeJson creates file if missing', () => {
  const { dir, file } = makeTempFile()
  try {
    process.env['OURO_REPO_ROOT'] = '/test/repo'
    patchClaudeJson('mydb', { command: 'npx', args: ['-y', 'server-postgres', 'pg://host/db'] }, file)

    const data = readJson(file) as Record<string, unknown>
    assert.ok(data['projects'] !== undefined)
    const projects = data['projects'] as Record<string, unknown>
    const project = projects['/test/repo'] as Record<string, unknown>
    assert.ok(project !== undefined)
    const mcpServers = project['mcpServers'] as Record<string, unknown>
    assert.ok(mcpServers['mydb'] !== undefined)
  } finally {
    delete process.env['OURO_REPO_ROOT']
    rmSync(dir, { recursive: true })
  }
})

test('patchClaudeJson adds entry to existing file', () => {
  const { dir, file } = makeTempFile()
  try {
    process.env['OURO_REPO_ROOT'] = '/test/repo'
    const config1 = { command: 'npx', args: ['-y', 'server-postgres', 'pg://host/db1'] }
    const config2 = { command: 'npx', args: ['-y', 'server-postgres', 'pg://host/db2'] }

    patchClaudeJson('db1', config1, file)
    patchClaudeJson('db2', config2, file)

    const data = readJson(file) as Record<string, unknown>
    const projects = data['projects'] as Record<string, unknown>
    const project = projects['/test/repo'] as Record<string, unknown>
    const mcpServers = project['mcpServers'] as Record<string, unknown>

    assert.ok(mcpServers['db1'] !== undefined)
    assert.ok(mcpServers['db2'] !== undefined)
  } finally {
    delete process.env['OURO_REPO_ROOT']
    rmSync(dir, { recursive: true })
  }
})

test('patchClaudeJson overwrites existing entry', () => {
  const { dir, file } = makeTempFile()
  try {
    process.env['OURO_REPO_ROOT'] = '/test/repo'
    const config1 = { command: 'npx', args: ['-y', 'server-postgres', 'pg://host/old'] }
    const config2 = { command: 'npx', args: ['-y', 'server-postgres', 'pg://host/new'] }

    patchClaudeJson('mydb', config1, file)
    patchClaudeJson('mydb', config2, file)

    const data = readJson(file) as Record<string, unknown>
    const projects = data['projects'] as Record<string, unknown>
    const project = projects['/test/repo'] as Record<string, unknown>
    const mcpServers = project['mcpServers'] as Record<string, unknown>
    const entry = mcpServers['mydb'] as Record<string, unknown>
    const args = entry['args'] as string[]

    assert.ok(args.includes('pg://host/new'))
    assert.ok(!args.includes('pg://host/old'))
  } finally {
    delete process.env['OURO_REPO_ROOT']
    rmSync(dir, { recursive: true })
  }
})

test('removeFromClaudeJson removes entry', () => {
  const { dir, file } = makeTempFile()
  try {
    process.env['OURO_REPO_ROOT'] = '/test/repo'
    const config = { command: 'npx', args: ['-y', 'server-postgres', 'pg://host/db'] }

    patchClaudeJson('mydb', config, file)
    removeFromClaudeJson('mydb', file)

    const data = readJson(file) as Record<string, unknown>
    const projects = data['projects'] as Record<string, unknown>
    const project = projects['/test/repo'] as Record<string, unknown>
    const mcpServers = project['mcpServers'] as Record<string, unknown>

    assert.ok(mcpServers['mydb'] === undefined)
  } finally {
    delete process.env['OURO_REPO_ROOT']
    rmSync(dir, { recursive: true })
  }
})

test('removeFromClaudeJson is a no-op when file does not exist', () => {
  const { dir, file } = makeTempFile()
  try {
    process.env['OURO_REPO_ROOT'] = '/test/repo'
    // file doesn't exist — should not throw
    assert.doesNotThrow(() => removeFromClaudeJson('nonexistent', file))
  } finally {
    delete process.env['OURO_REPO_ROOT']
    rmSync(dir, { recursive: true })
  }
})

test('removeFromClaudeJson is a no-op when name not registered', () => {
  const { dir, file } = makeTempFile()
  try {
    process.env['OURO_REPO_ROOT'] = '/test/repo'
    const config = { command: 'npx', args: ['-y', 'server-postgres', 'pg://host/db'] }
    patchClaudeJson('mydb', config, file)

    // Remove something that doesn't exist — should not throw
    assert.doesNotThrow(() => removeFromClaudeJson('nonexistent', file))

    // Original entry should be untouched
    const data = readJson(file) as Record<string, unknown>
    const projects = data['projects'] as Record<string, unknown>
    const project = projects['/test/repo'] as Record<string, unknown>
    const mcpServers = project['mcpServers'] as Record<string, unknown>
    assert.ok(mcpServers['mydb'] !== undefined)
  } finally {
    delete process.env['OURO_REPO_ROOT']
    rmSync(dir, { recursive: true })
  }
})

test('patchClaudeJson preserves existing non-project keys', () => {
  const { dir, file } = makeTempFile()
  try {
    process.env['OURO_REPO_ROOT'] = '/test/repo'

    // Pre-write a file with existing data
    writeFileSync(file, JSON.stringify({ userPreference: 'dark', projects: {} }), 'utf8')

    patchClaudeJson('mydb', { command: 'npx', args: [] }, file)

    const data = readJson(file) as Record<string, unknown>
    assert.equal(data['userPreference'], 'dark')
  } finally {
    delete process.env['OURO_REPO_ROOT']
    rmSync(dir, { recursive: true })
  }
})
