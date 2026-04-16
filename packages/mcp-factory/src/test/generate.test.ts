import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateConfig, StubError } from '../generate.js'

test('pg:// generates postgres MCP config with postgresql:// URL', () => {
  const config = generateConfig('pg', 'pg://user:pass@host/db')
  assert.equal(config.command, 'npx')
  assert.deepEqual(config.args[0], '-y')
  assert.equal(config.args[1], '@modelcontextprotocol/server-postgres')
  // Should normalize pg:// to postgresql://
  assert.ok(config.args[2]?.startsWith('postgresql://'))
})

test('pg:// with postgres:// URL passes through unchanged', () => {
  const cs = 'postgres://user:pass@host/db'
  const config = generateConfig('pg', cs)
  // postgres:// is not pg:// so it passes through as-is
  assert.equal(config.args[2], cs)
})

test('file:// generates filesystem MCP config', () => {
  const config = generateConfig('file', 'file:///data/reports')
  assert.equal(config.command, 'npx')
  assert.equal(config.args[1], '@modelcontextprotocol/server-filesystem')
  assert.equal(config.args[2], '/data/reports')
})

test('github:// generates github MCP config with env', () => {
  process.env['GITHUB_TOKEN'] = 'test-token'
  const config = generateConfig('github', 'github://owner/repo')
  assert.equal(config.command, 'npx')
  assert.equal(config.args[1], '@modelcontextprotocol/server-github')
  assert.ok(config.env !== undefined)
  assert.equal(config.env['GITHUB_PERSONAL_ACCESS_TOKEN'], 'test-token')
  delete process.env['GITHUB_TOKEN']
})

test('sqlite:// generates sqlite MCP config', () => {
  const config = generateConfig('sqlite', 'sqlite:///app.db')
  assert.equal(config.command, 'npx')
  assert.equal(config.args[1], '@modelcontextprotocol/server-sqlite')
  assert.ok(config.args.includes('--db-path'))
  assert.equal(config.args[config.args.indexOf('--db-path') + 1], '/app.db')
})

test('s3:// throws StubError', () => {
  assert.throws(() => generateConfig('s3', 's3://bucket/prefix'), StubError)
})

test('gdrive:// throws StubError', () => {
  assert.throws(() => generateConfig('gdrive', 'gdrive://folder-id'), StubError)
})

test('onedrive:// throws StubError', () => {
  assert.throws(() => generateConfig('onedrive', 'onedrive://docs'), StubError)
})

test('http:// throws StubError', () => {
  assert.throws(() => generateConfig('http', 'http://api.internal/v1'), StubError)
})

test('https:// throws StubError', () => {
  assert.throws(() => generateConfig('https', 'https://api.internal/v1'), StubError)
})

test('StubError message mentions v1 and feedback', () => {
  try {
    generateConfig('s3', 's3://bucket')
    assert.fail('should have thrown')
  } catch (err) {
    assert.ok(err instanceof StubError)
    assert.ok(err.message.includes('v1'))
    assert.ok(err.message.includes('feedback'))
  }
})

test('pg config has no env by default', () => {
  const config = generateConfig('pg', 'pg://host/db')
  assert.equal(config.env, undefined)
})
