import { describe, it, expect, beforeAll, vi } from 'vitest'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { createOidcMiddleware } from '../oidc.js'
import type { Request, Response, NextFunction } from 'express'

// ---- helpers ----

interface MockRes {
  statusCode: number
  body: unknown
  locals: Record<string, unknown>
  status(code: number): this
  json(body: unknown): void
}

function mockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: undefined,
    locals: {},
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body },
  }
  return res
}

// ---- test fixtures ----

const ISSUER = 'https://idp.example.com'

let keyPair: Awaited<ReturnType<typeof generateKeyPair>>
let jwksUri: string

beforeAll(async () => {
  keyPair = await generateKeyPair('RS256')

  // Inline JWKS as data URI — no HTTP server needed
  const jwk = await exportJWK(keyPair.publicKey)
  jwk.use = 'sig'
  jwk.kid = 'test-key-1'
  const jwks = JSON.stringify({ keys: [jwk] })
  jwksUri = `data:application/json;base64,${Buffer.from(jwks).toString('base64')}`
})

async function signToken(opts: {
  issuer?: string
  subject?: string
  expired?: boolean
} = {}): Promise<string> {
  const builder = new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
    .setIssuer(opts.issuer ?? ISSUER)
    .setSubject(opts.subject ?? 'user-123')
    .setIssuedAt()

  if (opts.expired) {
    builder.setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
  } else {
    builder.setExpirationTime('1h')
  }

  return builder.sign(keyPair.privateKey)
}

async function makeMiddleware() {
  return createOidcMiddleware({ issuer: ISSUER, jwksUri })
}

function asExpressRes(res: MockRes): Response {
  return res as unknown as Response
}

// ---- tests ----

describe('createOidcMiddleware', () => {
  it('calls next() for a valid Bearer token', async () => {
    const middleware = await makeMiddleware()
    const token = await signToken()
    const req = { headers: { authorization: `Bearer ${token}` } } as Request
    const res = asExpressRes(mockRes())
    const next = vi.fn() as unknown as NextFunction

    await new Promise<void>((resolve) => {
      middleware(req, res, (...args) => { (next as ReturnType<typeof vi.fn>)(...args); resolve() })
    })

    expect(next).toHaveBeenCalledOnce()
  })

  it('sets res.locals.jwtPayload on success', async () => {
    const middleware = await makeMiddleware()
    const token = await signToken({ subject: 'alice' })
    const req = { headers: { authorization: `Bearer ${token}` } } as Request
    const raw = mockRes()
    const res = asExpressRes(raw)

    await new Promise<void>((resolve) => {
      middleware(req, res, resolve as NextFunction)
    })

    expect((raw.locals['jwtPayload'] as { sub?: string })?.sub).toBe('alice')
  })

  it('returns 401 when Authorization header is missing', async () => {
    const middleware = await makeMiddleware()
    const req = { headers: {} } as Request
    const raw = mockRes()
    const res = asExpressRes(raw)

    await new Promise<void>((resolve) => {
      middleware(req, res, resolve as NextFunction)
      setTimeout(resolve, 50)
    })

    expect(raw.statusCode).toBe(401)
    expect((raw.body as { error: string }).error).toMatch(/missing/)
  })

  it('returns 401 for a token with the wrong issuer', async () => {
    const middleware = await makeMiddleware()
    const token = await signToken({ issuer: 'https://evil.example.com' })
    const req = { headers: { authorization: `Bearer ${token}` } } as Request
    const raw = mockRes()
    const res = asExpressRes(raw)

    await new Promise<void>((resolve) => {
      middleware(req, res, resolve as NextFunction)
      setTimeout(resolve, 200)
    })

    expect(raw.statusCode).toBe(401)
    expect((raw.body as { error: string }).error).toMatch(/token validation failed/)
  })

  it('returns 401 for an expired token', async () => {
    const middleware = await makeMiddleware()
    const token = await signToken({ expired: true })
    const req = { headers: { authorization: `Bearer ${token}` } } as Request
    const raw = mockRes()
    const res = asExpressRes(raw)

    await new Promise<void>((resolve) => {
      middleware(req, res, resolve as NextFunction)
      setTimeout(resolve, 200)
    })

    expect(raw.statusCode).toBe(401)
    expect((raw.body as { error: string }).error).toMatch(/token validation failed/)
  })

  it('fetches the OIDC discovery doc when no jwksUri override is given', async () => {
    // Build a fresh JWKS data URI for this test (unique URI avoids jwksCache collision)
    const jwk = await exportJWK(keyPair.publicKey)
    jwk.use = 'sig'
    jwk.kid = 'discovery-test-key'
    const discoveryJwksUri = `data:application/json;base64,${Buffer.from(JSON.stringify({ keys: [jwk] })).toString('base64')}&discovery=1`

    const DISCOVERY_ISSUER = 'https://discovery-test.example.internal'
    const discoveryDoc = { issuer: DISCOVERY_ISSUER, jwks_uri: discoveryJwksUri }

    // Use vi.stubGlobal so vitest automatically restores fetch after the test
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/.well-known/openid-configuration')) {
        return new Response(JSON.stringify(discoveryDoc), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }))

    try {
      // createOidcMiddleware with no jwksUri must call fetch for the discovery doc
      await createOidcMiddleware({ issuer: DISCOVERY_ISSUER })
      expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
        `${DISCOVERY_ISSUER}/.well-known/openid-configuration`
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('returns 401 for a tampered token', async () => {
    // jose re-fetches the JWKS once on signature failure (key-rotation check).
    // Stub fetch so the re-fetch of the data: URI completes instantly rather than
    // hanging in environments where native fetch doesn't support data: URIs.
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url instanceof Request ? url.url : String(url)
      const m = /^data:[^;]+;base64,([^&\s]+)/.exec(urlStr)
      if (m) {
        const json = Buffer.from(m[1]!, 'base64').toString()
        return new Response(json, { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      throw new Error(`unexpected fetch: ${urlStr}`)
    }))

    try {
      const middleware = await makeMiddleware()
      const token = await signToken()
      const parts = token.split('.')
      const sig = parts[2] ?? ''
      parts[2] = sig.slice(0, -1) + (sig.endsWith('a') ? 'b' : 'a')
      const tampered = parts.join('.')

      const req = { headers: { authorization: `Bearer ${tampered}` } } as Request
      const raw = mockRes()
      const res = asExpressRes(raw)

      await new Promise<void>((resolve) => {
        middleware(req, res, resolve as NextFunction)
        setTimeout(resolve, 500)
      })

      expect(raw.statusCode).toBe(401)
      expect((raw.body as { error: string }).error).toMatch(/token validation failed/)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
