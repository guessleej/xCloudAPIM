/**
 * API Key Auth
 *
 * config keys:
 *   key_location  = "header" | "query" | "header,query"  (預設 header,query)
 *   header_name   = "X-API-Key"                          (預設 X-API-Key)
 *   query_param   = "api_key"                            (預設 api_key)
 *   fail_open     = "true"                               (Redis/Service 故障時放行)
 */
import { createHash } from 'node:crypto'
import { fetch } from 'undici'
import type { ExecContext, PluginDeps } from '../../types.js'
import { applyIdentity } from './claims.js'
import { config as appConfig } from '../../../config/index.js'
import { internalHeaders } from '../../../plugins/internal-token.js'

const KEY_PREFIX = 'xca_'

export async function apiKeyAuth(
  ctx:  ExecContext,
  deps: PluginDeps,
): Promise<{ ok: boolean; reason?: string }> {
  const cfg = deps.config
  const locations = (cfg['key_location'] ?? 'header,query').split(',').map((s) => s.trim())
  const headerName = (cfg['header_name'] ?? 'x-api-key').toLowerCase()
  const queryParam = cfg['query_param'] ?? 'api_key'

  let rawKey = ''

  for (const loc of locations) {
    if (loc === 'header') {
      rawKey = ctx.requestHeaders[headerName]
        ?? ctx.requestHeaders['x-api-key']
        ?? ''
      // Authorization: ApiKey <key>
      if (!rawKey) {
        const auth = ctx.requestHeaders['authorization'] ?? ''
        if (auth.toLowerCase().startsWith('apikey ')) rawKey = auth.slice(7).trim()
      }
    } else if (loc === 'query') {
      rawKey = ctx.queryParams[queryParam] ?? ''
      // 安全：從 query 取得後立刻從 context 移除，避免轉發到上游
      if (rawKey) delete ctx.queryParams[queryParam]
    }
    if (rawKey) break
  }

  if (!rawKey)                         return { ok: false, reason: 'missing API key' }
  if (!rawKey.startsWith(KEY_PREFIX)) return { ok: false, reason: 'invalid API key format' }

  // ─── L1: Redis 快取 ─────────────────────────────────────
  const hash     = sha256Hex(rawKey)
  const cacheKey = `apikey:info:${hash}`
  try {
    const info = await deps.redis.hgetall(cacheKey)
    if (info && Object.keys(info).length > 0) {
      if (info['status'] !== 'active') return { ok: false, reason: 'api key is not active' }
      injectFromCache(ctx, info)
      return { ok: true }
    }
  } catch { /* fall through */ }

  // ─── L2: Subscription Service ───────────────────────────
  try {
    const resp = await fetch(`${appConfig.SUBSCRIPTION_SERVICE_URL}/internal/keys/verify`, {
      method:  'POST',
      headers: { 'content-type': 'application/json', ...internalHeaders() },
      body:    JSON.stringify({ key: rawKey }),
      signal:  AbortSignal.timeout(3000),
    })

    if (resp.status === 401) return { ok: false, reason: 'invalid or revoked API key' }
    if (resp.status === 403) return { ok: false, reason: 'subscription is not active' }
    if (!resp.ok) {
      if (cfg['fail_open'] === 'true') return { ok: true }
      return { ok: false, reason: 'auth service unavailable' }
    }

    const body = await resp.json() as Record<string, unknown>
    applyIdentity(ctx, {
      clientId:       String(body['key_id']          ?? ''),
      userId:         '',
      plan:           String(body['plan']             ?? ''),
      subscriptionId: String(body['subscription_id'] ?? ''),
      orgId:          String(body['organization_id'] ?? ''),
      scopes:         [],
      claims:         {},
    })
    ctx.apiId = String(body['api_id'] ?? ctx.apiId)
    return { ok: true }
  } catch (err) {
    deps.log.warn({ err }, 'api key verify error')
    if (cfg['fail_open'] === 'true') return { ok: true }
    return { ok: false, reason: 'auth service unavailable' }
  }
}

function injectFromCache(ctx: ExecContext, info: Record<string, string>): void {
  applyIdentity(ctx, {
    clientId:       info['key_id']   ?? '',
    userId:         '',
    plan:           info['plan_name'] ?? '',
    subscriptionId: info['sub_id']   ?? '',
    orgId:          info['org_id']   ?? '',
    scopes:         [],
    claims:         {},
  })
  if (info['api_id']) ctx.apiId = info['api_id']
}

function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}
