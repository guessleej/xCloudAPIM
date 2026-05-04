/**
 * OAuth2 Token Introspection (RFC 7662)
 * 對不透明 Token（Opaque Token）呼叫 /introspect 端點驗證
 *
 * config keys:
 *   introspect_url   = "https://auth.example.com/oauth2/introspect"
 *   client_id        = "gateway-client"     (Basic Auth to introspect endpoint)
 *   client_secret    = "secret"
 *   cache_ttl_s      = "60"                 (introspect 結果快取秒數，預設 60)
 *   required_scopes  = "read:api"
 *   fail_open        = "false"
 */
import { createHash } from 'node:crypto'
import { fetch } from 'undici'
import type { ExecContext, PluginDeps } from '../../types.js'
import { applyIdentity, forwardClaims, extractScopes } from './claims.js'
import { config as appConfig } from '../../../config/index.js'

export async function tokenIntrospect(
  ctx:  ExecContext,
  deps: PluginDeps,
): Promise<{ ok: boolean; reason?: string }> {
  const cfg = deps.config

  // Bearer token
  const auth = ctx.requestHeaders['authorization'] ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return { ok: false, reason: 'missing Bearer token' }
  }
  const token = auth.slice(7).trim()

  const introspectUrl = cfg['introspect_url']
    ?? `${appConfig.AUTH_SERVICE_URL}/oauth2/introspect`
  const cacheTtlS = parseInt(cfg['cache_ttl_s'] ?? '60', 10) || 60

  // ─── Redis 快取（以 token hash 為 key）──────────────────
  const tokenHash = createHash('sha256').update(token).digest('hex').slice(0, 32)
  const cacheKey  = `introspect:${tokenHash}`

  try {
    const cached = await deps.redis.get(cacheKey)
    if (cached) {
      const info = JSON.parse(cached) as IntrospectResponse
      if (!info.active) return { ok: false, reason: 'token is not active' }
      return applyIntrospectResult(ctx, info, cfg)
    }
  } catch { /* fall through */ }

  // ─── 呼叫 Introspect 端點 ───────────────────────────────
  const clientId     = cfg['client_id']     ?? ''
  const clientSecret = cfg['client_secret'] ?? ''
  const basicCreds   = clientId
    ? `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
    : undefined

  try {
    const body = new URLSearchParams({ token })
    const resp = await fetch(introspectUrl, {
      method:  'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(basicCreds ? { authorization: basicCreds } : {}),
      },
      body:   body.toString(),
      signal: AbortSignal.timeout(3000),
    })

    if (!resp.ok) {
      if (cfg['fail_open'] === 'true') return { ok: true }
      return { ok: false, reason: `introspect endpoint error: ${resp.status}` }
    }

    const info = await resp.json() as IntrospectResponse
    if (!info.active) {
      // 快取失效結果（短 TTL）
      try { await deps.redis.set(cacheKey, JSON.stringify(info), 'EX', 10) } catch {}
      return { ok: false, reason: 'token is not active' }
    }

    // 快取有效結果
    try { await deps.redis.set(cacheKey, JSON.stringify(info), 'EX', cacheTtlS) } catch {}
    return applyIntrospectResult(ctx, info, cfg)
  } catch (err) {
    deps.log.warn({ err }, 'introspect error')
    if (cfg['fail_open'] === 'true') return { ok: true }
    return { ok: false, reason: 'introspect service unavailable' }
  }
}

interface IntrospectResponse {
  active:     boolean
  sub?:       string
  client_id?: string
  scope?:     string
  exp?:       number
  iat?:       number
  iss?:       string
  username?:  string
  plan?:      string
  org_id?:    string
  [k: string]: unknown
}

function applyIntrospectResult(
  ctx:  ExecContext,
  info: IntrospectResponse,
  cfg:  Record<string, string>,
): { ok: boolean; reason?: string } {
  // Scope 驗證
  const requiredScopes = cfg['required_scopes']
  if (requiredScopes) {
    const scopes = extractScopes(info as Record<string, unknown>)
    for (const s of requiredScopes.split(/\s+/).filter(Boolean)) {
      if (!scopes.includes(s)) return { ok: false, reason: `insufficient scope: ${s}` }
    }
  }

  const claims = info as Record<string, unknown>
  applyIdentity(ctx, {
    clientId:       info.client_id ?? '',
    userId:         info.sub ?? info.username ?? '',
    plan:           info.plan ?? '',
    subscriptionId: '',
    orgId:          info.org_id ?? '',
    scopes:         extractScopes(claims),
    claims,
  })

  if (cfg['forward_claims']) forwardClaims(ctx, claims, cfg['forward_claims'])
  return { ok: true }
}
