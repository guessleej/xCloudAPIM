/**
 * JWT Auth — 支援 RS256 / HS256 / ES256
 *
 * config keys:
 *   algorithm      = "RS256" | "HS256" | "ES256"   (預設 RS256)
 *   jwks_url       = "https://..."                  (RS256 / ES256)
 *   secret         = "my-hmac-secret"               (HS256，建議從 Vault 注入)
 *   issuer         = "https://auth.example.com"     (可選)
 *   audience       = "api://my-api"                 (可選)
 *   required_scopes = "read:api write:api"           (空格分隔)
 *   token_source   = "header" | "cookie:<name>"     (預設 header)
 *   cookie_name    = "access_token"                 (token_source=cookie 時)
 *   forward_claims = "sub,email,plan" | "*"         (轉注 claims 為 X-Claim-* header)
 */
import { createRemoteJWKSet, jwtVerify, createSecretKey } from 'jose'
import type { ExecContext, PluginDeps } from '../../types.js'
import { applyIdentity, forwardClaims, extractScopes } from './claims.js'
import { config as appConfig } from '../../../config/index.js'

// 每個 JWKS URL 獨立快取
const jwksCache = new Map<string, { set: ReturnType<typeof createRemoteJWKSet>; at: number }>()

function getJWKS(url: string, ttlMs: number): ReturnType<typeof createRemoteJWKSet> {
  const cached = jwksCache.get(url)
  if (cached && Date.now() - cached.at < ttlMs) return cached.set
  const set = createRemoteJWKSet(new URL(url))
  jwksCache.set(url, { set, at: Date.now() })
  return set
}

export async function jwtAuth(
  ctx:  ExecContext,
  deps: PluginDeps,
): Promise<{ ok: boolean; reason?: string }> {
  const cfg       = deps.config
  const algorithm = cfg['algorithm'] ?? 'RS256'
  const tokenSource = cfg['token_source'] ?? 'header'

  // ─── Token 取得 ───────────────────────────────────────────
  const token = extractToken(ctx, tokenSource, cfg['cookie_name'])
  if (!token) {
    return { ok: false, reason: 'missing Bearer token' }
  }

  // ─── 驗簽 ─────────────────────────────────────────────────
  try {
    let verifyKey: Parameters<typeof jwtVerify>[1]

    if (algorithm === 'HS256') {
      const secret = cfg['secret']
      if (!secret) return { ok: false, reason: 'HS256 secret not configured' }
      verifyKey = createSecretKey(Buffer.from(secret, 'utf-8'))
    } else {
      const jwksUrl = cfg['jwks_url'] ?? appConfig.JWKS_URL
      verifyKey = getJWKS(jwksUrl, appConfig.JWKS_CACHE_TTL_MS)
    }

    const { payload } = await jwtVerify(token, verifyKey, {
      algorithms: [algorithm as 'RS256' | 'HS256' | 'ES256'],
      issuer:     cfg['issuer']   || undefined,
      audience:   cfg['audience'] || undefined,
    })

    const claims = payload as Record<string, unknown>

    // ─── Scope 驗證 ──────────────────────────────────────────
    const requiredScopes = cfg['required_scopes']
    if (requiredScopes) {
      const tokenScopes = extractScopes(claims)
      for (const s of requiredScopes.split(/\s+/).filter(Boolean)) {
        if (!tokenScopes.includes(s)) {
          return { ok: false, reason: `insufficient scope: ${s}` }
        }
      }
    }

    // ─── 注入 ExecContext ────────────────────────────────────
    applyIdentity(ctx, {
      clientId:       String(claims['client_id'] ?? ''),
      userId:         String(claims['sub']       ?? ''),
      plan:           String(claims['plan']      ?? ''),
      subscriptionId: String(claims['subscription_id'] ?? ''),
      orgId:          String(claims['org_id']    ?? ''),
      scopes:         extractScopes(claims),
      claims,
    })

    // claims 轉注為 headers
    if (cfg['forward_claims']) {
      forwardClaims(ctx, claims, cfg['forward_claims'])
    }

    return { ok: true }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'invalid token'
    return { ok: false, reason: `JWT verification failed: ${msg}` }
  }
}

function extractToken(
  ctx:        ExecContext,
  source:     string,
  cookieName?: string,
): string | null {
  if (source.startsWith('cookie:') || source === 'cookie') {
    const name = source.startsWith('cookie:') ? source.slice(7) : (cookieName ?? 'access_token')
    const cookie = ctx.requestHeaders['cookie'] ?? ''
    const match = cookie.match(new RegExp(`(?:^|;)\\s*${escapeRegex(name)}=([^;]+)`))
    return match ? decodeURIComponent(match[1]!) : null
  }

  // header（預設）：支援 Authorization: Bearer <token>
  const auth = ctx.requestHeaders['authorization'] ?? ''
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
  return null
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
