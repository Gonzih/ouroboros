import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { RequestHandler } from 'express'

interface OidcDiscovery {
  jwks_uri: string
  issuer: string
}

interface OidcMiddlewareOptions {
  issuer: string
  /** Override JWKS URI — used in tests to inject a local key set */
  jwksUri?: string
}

// Cached JWKS fetcher (one per URI, lives for process lifetime)
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

async function resolveJwksUri(issuer: string): Promise<string> {
  const discoveryUrl = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
  const res = await fetch(discoveryUrl)
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status} ${discoveryUrl}`)
  const doc = await res.json() as OidcDiscovery
  if (!doc.jwks_uri) throw new Error('OIDC discovery doc missing jwks_uri')
  return doc.jwks_uri
}

function getJwks(jwksUri: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(jwksUri)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUri))
    jwksCache.set(jwksUri, jwks)
  }
  return jwks
}

/**
 * Express middleware that validates Bearer JWTs against the given OIDC issuer.
 * On success, sets res.locals.jwtPayload to the verified JWT claims.
 * Returns 401 if the token is absent, expired, tampered, or from the wrong issuer.
 */
export async function createOidcMiddleware(
  opts: OidcMiddlewareOptions
): Promise<RequestHandler> {
  const jwksUri = opts.jwksUri ?? await resolveJwksUri(opts.issuer)
  const jwks = getJwks(jwksUri)

  const handler: RequestHandler = (req, res, next) => {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'missing or invalid Authorization header' })
      return
    }
    const token = authHeader.slice(7)
    jwtVerify(token, jwks, { issuer: opts.issuer })
      .then(({ payload }) => {
        res.locals['jwtPayload'] = payload
        next()
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        res.status(401).json({ error: `token validation failed: ${message}` })
      })
  }

  return handler
}
