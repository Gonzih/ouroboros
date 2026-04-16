import { describe, it, expect, afterEach } from 'vitest'
import { generateConfig, StubError } from '../generate.js'

describe('generateConfig', () => {
  describe('pg scheme', () => {
    it('returns npx MCP postgres server config', () => {
      const config = generateConfig('pg', 'pg://localhost/mydb')
      expect(config.command).toBe('npx')
      expect(config.args).toContain('@modelcontextprotocol/server-postgres')
    })

    it('normalizes pg:// to postgresql:// in args', () => {
      const config = generateConfig('pg', 'pg://localhost/mydb')
      const urlArg = config.args.find(a => a.startsWith('postgresql://'))
      expect(urlArg).toBeDefined()
    })

    it('leaves postgresql:// URL as-is', () => {
      const config = generateConfig('pg', 'postgresql://host/db')
      const urlArg = config.args.find(a => a.startsWith('postgresql://'))
      expect(urlArg).toBe('postgresql://host/db')
    })
  })

  describe('file scheme', () => {
    it('returns filesystem MCP server config', () => {
      const config = generateConfig('file', 'file:///home/user/docs')
      expect(config.command).toBe('npx')
      expect(config.args).toContain('@modelcontextprotocol/server-filesystem')
      expect(config.args).toContain('/home/user/docs')
    })

    it('strips file:// prefix from path', () => {
      const config = generateConfig('file', 'file:///tmp/data')
      expect(config.args).toContain('/tmp/data')
    })
  })

  describe('github scheme', () => {
    const savedToken = process.env['GITHUB_TOKEN']

    afterEach(() => {
      if (savedToken === undefined) delete process.env['GITHUB_TOKEN']
      else process.env['GITHUB_TOKEN'] = savedToken
    })

    it('returns github MCP server config', () => {
      process.env['GITHUB_TOKEN'] = 'ghp_test_token'
      const config = generateConfig('github', 'github://owner/repo')
      expect(config.command).toBe('npx')
      expect(config.args).toContain('@modelcontextprotocol/server-github')
      expect(config.env?.['GITHUB_PERSONAL_ACCESS_TOKEN']).toBe('ghp_test_token')
    })

    it('uses empty string when GITHUB_TOKEN not set', () => {
      delete process.env['GITHUB_TOKEN']
      const config = generateConfig('github', 'github://owner/repo')
      expect(config.env?.['GITHUB_PERSONAL_ACCESS_TOKEN']).toBe('')
    })
  })

  describe('sqlite scheme', () => {
    it('returns sqlite MCP server config', () => {
      const config = generateConfig('sqlite', 'sqlite:///tmp/app.db')
      expect(config.args).toContain('@modelcontextprotocol/server-sqlite')
      expect(config.args).toContain('/tmp/app.db')
    })
  })

  describe('stub schemes', () => {
    it.each(['s3', 'gdrive', 'onedrive', 'http', 'https'])('throws StubError for %s', (scheme) => {
      expect(() => generateConfig(scheme, `${scheme}://example`)).toThrow(StubError)
    })
  })
})
