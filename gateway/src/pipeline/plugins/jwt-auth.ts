import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { ExecContext, PluginDeps } from '../types.js'
import { abort } from '../types.js'
import { config } from '../../config/index.js'

// JWKS 快取（模組級單例，跨請求共用）
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null
let jwksBuiltAt = 0

function getJWKS(): ReturnType<typeof createRemoteJWKSet> {
  const now = Date.now()
  if (!jwks || now - jwksBuiltAt > config.JWKS_CACHE_TTL_MS) {
    jwks = createRemoteJWKSet(new URL(config.JWKS_URL))
    jwksBuiltAt = now
  }
  return jwks
}

export async function jwtAuth(ctx: ExecContext, deps: PluginDeps): Promise<void> {
  const authHeader = ctx.requestHeaders['authorization'] ?? ctx.requestHeaders['Authorization'] ?? ''
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    abort(ctx, 401, 'missing or invalid Authorization header')
    return
  }

  const token = authHeader.slice(7).trim()

  try {
    const { payload } = await jwtVerify(token, getJWKS(), {
      algorithms:  ['RS256'],
      issuer:      deps.config['issuer']   || undefined,
      audience:    deps.config['audience'] || undefined,
    })

    // 驗證 required_scopes
    const requiredScopes = deps.config['required_scopes']
    if (requiredScopes) {
      const tokenScopes = extractScopes(payload as Record<string, unknown>)
      for (const req of requiredScopes.split(/\s+/)) {
        if (!tokenScopes.includes(req)) {
          abort(ctx, 403, `insufficient scope: ${req}`)
          return
        }
      }
    }

    // 注入 claims
    for (const [k, v] of Object.entries(payload)) {
      ctx.claims[k] = v
    }
    if (typeof payload['client_id'] === 'string') {
      ctx.clientId = payload['client_id']
      ctx.requestHeaders['x-client-id'] = payload['client_id']
    }
    if (typeof payload['sub'] === 'string') {
      ctx.requestHeaders['x-user-id'] = payload['sub']
    }
    if (typeof payload['plan'] === 'string') {
      ctx.plan = payload['plan']
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'invalid token'
    abort(ctx, 401, `JWT verification failed: ${msg}`)
  }
}

function extractScopes(payload: Record<string, unknown>): string[] {
  const raw = payload['scopes'] ?? payload['scope']
  if (Array.isArray(raw))         return raw.filter((s): s is string => typeof s === 'string')
  if (typeof raw === 'string')    return raw.split(/\s+/)
  return []
}
