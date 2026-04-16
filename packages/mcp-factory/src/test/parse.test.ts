import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseConnectionString, ParseError } from '../parse.js'

test('parses pg:// and normalizes scheme', () => {
  const r = parseConnectionString('pg://user:pass@host/db')
  assert.equal(r.scheme, 'pg')
  assert.equal(r.path, 'user:pass@host/db')
  assert.equal(r.raw, 'pg://user:pass@host/db')
})

test('normalizes postgres:// to pg', () => {
  const r = parseConnectionString('postgres://user:pass@host/db')
  assert.equal(r.scheme, 'pg')
})

test('normalizes postgresql:// to pg', () => {
  const r = parseConnectionString('postgresql://user:pass@host/db')
  assert.equal(r.scheme, 'pg')
})

test('parses file:// scheme', () => {
  const r = parseConnectionString('file:///data/reports')
  assert.equal(r.scheme, 'file')
  assert.equal(r.path, '/data/reports')
})

test('parses github:// scheme', () => {
  const r = parseConnectionString('github://owner/repo')
  assert.equal(r.scheme, 'github')
  assert.equal(r.path, 'owner/repo')
})

test('parses sqlite:// scheme', () => {
  const r = parseConnectionString('sqlite:///app.db')
  assert.equal(r.scheme, 'sqlite')
  assert.equal(r.path, '/app.db')
})

test('parses s3:// scheme', () => {
  const r = parseConnectionString('s3://bucket/prefix')
  assert.equal(r.scheme, 's3')
})

test('parses gdrive:// scheme', () => {
  const r = parseConnectionString('gdrive://folder-id')
  assert.equal(r.scheme, 'gdrive')
})

test('parses onedrive:// scheme', () => {
  const r = parseConnectionString('onedrive://Documents/data')
  assert.equal(r.scheme, 'onedrive')
})

test('parses http:// scheme', () => {
  const r = parseConnectionString('http://api.internal/v1')
  assert.equal(r.scheme, 'http')
})

test('parses https:// scheme', () => {
  const r = parseConnectionString('https://api.internal/v1')
  assert.equal(r.scheme, 'https')
})

test('throws ParseError for missing ://', () => {
  assert.throws(() => parseConnectionString('notaurl'), ParseError)
})

test('throws ParseError for unknown scheme', () => {
  assert.throws(() => parseConnectionString('ftp://example.com'), ParseError)
})

test('throws ParseError with descriptive message for unknown scheme', () => {
  try {
    parseConnectionString('ftp://example.com')
    assert.fail('should have thrown')
  } catch (err) {
    assert.ok(err instanceof ParseError)
    assert.ok(err.message.includes('ftp'))
  }
})

test('raw preserves the original connection string', () => {
  const cs = 'postgres://user:pass@localhost:5432/mydb'
  const r = parseConnectionString(cs)
  assert.equal(r.raw, cs)
})
