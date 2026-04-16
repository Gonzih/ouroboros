import { describe, it, expect } from 'vitest'
import { parseConnectionString, ParseError } from '../parse.js'

describe('parseConnectionString', () => {
  it('parses pg:// scheme', () => {
    const result = parseConnectionString('pg://localhost:5432/mydb')
    expect(result.scheme).toBe('pg')
    expect(result.path).toBe('localhost:5432/mydb')
    expect(result.raw).toBe('pg://localhost:5432/mydb')
  })

  it('normalizes postgres:// to pg', () => {
    const result = parseConnectionString('postgres://user:pass@host/db')
    expect(result.scheme).toBe('pg')
  })

  it('normalizes postgresql:// to pg', () => {
    const result = parseConnectionString('postgresql://host/db')
    expect(result.scheme).toBe('pg')
  })

  it('parses file:// scheme', () => {
    const result = parseConnectionString('file:///home/user/docs')
    expect(result.scheme).toBe('file')
    expect(result.path).toBe('/home/user/docs')
  })

  it('parses github:// scheme', () => {
    const result = parseConnectionString('github://owner/repo')
    expect(result.scheme).toBe('github')
  })

  it('parses sqlite:// scheme', () => {
    const result = parseConnectionString('sqlite:///tmp/mydb.db')
    expect(result.scheme).toBe('sqlite')
  })

  it('parses s3:// scheme', () => {
    const result = parseConnectionString('s3://my-bucket/prefix')
    expect(result.scheme).toBe('s3')
  })

  it('parses http:// scheme', () => {
    const result = parseConnectionString('http://localhost:3000/api')
    expect(result.scheme).toBe('http')
  })

  it('throws ParseError when :// is missing', () => {
    expect(() => parseConnectionString('localhostmydb')).toThrow(ParseError)
    expect(() => parseConnectionString('localhostmydb')).toThrow('missing')
  })

  it('throws ParseError for unknown scheme', () => {
    expect(() => parseConnectionString('ftp://host/path')).toThrow(ParseError)
    expect(() => parseConnectionString('ftp://host/path')).toThrow('Unknown scheme')
  })
})
