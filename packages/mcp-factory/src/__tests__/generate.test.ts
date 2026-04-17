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

  describe('http/https scheme', () => {
    it('returns fetch MCP server config for https', () => {
      const config = generateConfig('https', 'https://api.example.com')
      expect(config.command).toBe('npx')
      expect(config.args).toContain('@modelcontextprotocol/server-fetch')
      expect(config.args).toContain('https://api.example.com')
    })

    it('returns fetch MCP server config for http', () => {
      const config = generateConfig('http', 'http://localhost:3000')
      expect(config.args).toContain('@modelcontextprotocol/server-fetch')
      expect(config.args).toContain('http://localhost:3000')
    })
  })

  describe('s3 scheme', () => {
    const savedKeyId = process.env['AWS_ACCESS_KEY_ID']
    const savedSecret = process.env['AWS_SECRET_ACCESS_KEY']
    const savedRegion = process.env['AWS_REGION']
    const savedProfile = process.env['AWS_PROFILE']

    afterEach(() => {
      if (savedKeyId === undefined) delete process.env['AWS_ACCESS_KEY_ID']
      else process.env['AWS_ACCESS_KEY_ID'] = savedKeyId
      if (savedSecret === undefined) delete process.env['AWS_SECRET_ACCESS_KEY']
      else process.env['AWS_SECRET_ACCESS_KEY'] = savedSecret
      if (savedRegion === undefined) delete process.env['AWS_REGION']
      else process.env['AWS_REGION'] = savedRegion
      if (savedProfile === undefined) delete process.env['AWS_PROFILE']
      else process.env['AWS_PROFILE'] = savedProfile
    })

    it('returns mcp-server-s3 config with credentials from env', () => {
      process.env['AWS_ACCESS_KEY_ID'] = 'AKIAIOSFODNN7EXAMPLE'
      process.env['AWS_SECRET_ACCESS_KEY'] = 'wJalrXUtnFEMI/K7MDENG'
      process.env['AWS_REGION'] = 'us-west-2'
      const config = generateConfig('s3', 's3://my-bucket/data')
      expect(config.command).toBe('npx')
      expect(config.args).toContain('mcp-server-s3')
      expect(config.env?.['AWS_ACCESS_KEY_ID']).toBe('AKIAIOSFODNN7EXAMPLE')
      expect(config.env?.['AWS_SECRET_ACCESS_KEY']).toBe('wJalrXUtnFEMI/K7MDENG')
      expect(config.env?.['AWS_REGION']).toBe('us-west-2')
    })

    it('uses AWS_PROFILE when set instead of key/secret', () => {
      delete process.env['AWS_ACCESS_KEY_ID']
      delete process.env['AWS_SECRET_ACCESS_KEY']
      delete process.env['AWS_REGION']
      process.env['AWS_PROFILE'] = 'corp-prod'
      const config = generateConfig('s3', 's3://corp-data/docs')
      expect(config.env?.['AWS_PROFILE']).toBe('corp-prod')
      expect(config.env?.['AWS_ACCESS_KEY_ID']).toBeUndefined()
    })

    it('returns no env when no AWS credentials are set', () => {
      delete process.env['AWS_ACCESS_KEY_ID']
      delete process.env['AWS_SECRET_ACCESS_KEY']
      delete process.env['AWS_REGION']
      delete process.env['AWS_PROFILE']
      const config = generateConfig('s3', 's3://bucket/prefix')
      expect(config.env).toBeUndefined()
    })
  })

  describe('gdrive scheme', () => {
    it('returns gdrive MCP server config', () => {
      const config = generateConfig('gdrive', 'gdrive:///home/user/sa.json')
      expect(config.command).toBe('npx')
      expect(config.args).toContain('@modelcontextprotocol/server-gdrive')
      expect(config.env?.['GOOGLE_APPLICATION_CREDENTIALS']).toBe('/home/user/sa.json')
    })

    it('strips gdrive:// prefix from credentials path', () => {
      const config = generateConfig('gdrive', 'gdrive:///etc/sa-credentials.json')
      expect(config.env?.['GOOGLE_APPLICATION_CREDENTIALS']).toBe('/etc/sa-credentials.json')
    })
  })

  describe('onedrive scheme', () => {
    const savedClientId = process.env['MICROSOFT_CLIENT_ID']
    const savedClientSecret = process.env['MICROSOFT_CLIENT_SECRET']
    const savedTenantId = process.env['MICROSOFT_TENANT_ID']

    afterEach(() => {
      if (savedClientId === undefined) delete process.env['MICROSOFT_CLIENT_ID']
      else process.env['MICROSOFT_CLIENT_ID'] = savedClientId
      if (savedClientSecret === undefined) delete process.env['MICROSOFT_CLIENT_SECRET']
      else process.env['MICROSOFT_CLIENT_SECRET'] = savedClientSecret
      if (savedTenantId === undefined) delete process.env['MICROSOFT_TENANT_ID']
      else process.env['MICROSOFT_TENANT_ID'] = savedTenantId
    })

    it('returns cli-microsoft365-mcp-server config with credentials from env', () => {
      process.env['MICROSOFT_CLIENT_ID'] = 'app-id-123'
      process.env['MICROSOFT_CLIENT_SECRET'] = 'secret-abc'
      process.env['MICROSOFT_TENANT_ID'] = 'tenant-xyz'
      const config = generateConfig('onedrive', 'onedrive://Documents/data')
      expect(config.command).toBe('npx')
      expect(config.args).toContain('@pnp/cli-microsoft365-mcp-server')
      expect(config.env?.['MICROSOFT_CLIENT_ID']).toBe('app-id-123')
      expect(config.env?.['MICROSOFT_CLIENT_SECRET']).toBe('secret-abc')
      expect(config.env?.['MICROSOFT_TENANT_ID']).toBe('tenant-xyz')
    })

    it('returns no env when no Microsoft credentials are set', () => {
      delete process.env['MICROSOFT_CLIENT_ID']
      delete process.env['MICROSOFT_CLIENT_SECRET']
      delete process.env['MICROSOFT_TENANT_ID']
      const config = generateConfig('onedrive', 'onedrive://Documents')
      expect(config.env).toBeUndefined()
    })

    it('passes partial credentials when only some vars are set', () => {
      delete process.env['MICROSOFT_CLIENT_ID']
      delete process.env['MICROSOFT_CLIENT_SECRET']
      process.env['MICROSOFT_TENANT_ID'] = 'tenant-only'
      const config = generateConfig('onedrive', 'onedrive://Docs')
      expect(config.env?.['MICROSOFT_TENANT_ID']).toBe('tenant-only')
      expect(config.env?.['MICROSOFT_CLIENT_ID']).toBeUndefined()
    })
  })

  describe('unknown scheme', () => {
    it('throws StubError for an unrecognised scheme', () => {
      expect(() => generateConfig('ftp', 'ftp://example')).toThrow(StubError)
    })
  })
})
