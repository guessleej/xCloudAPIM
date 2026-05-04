import { createHash } from 'node:crypto'
import { fetch } from 'undici'
import type { ExecContext, PluginDeps } from '../types.js'
import { abort } from '../types.js'
import { config } from '../../config/index.js'

const API_KEY_PREFIX = 'xca_'

export async function apiKeyAuth(ctx: ExecContext, deps: PluginDeps): Promise<void> {
  // 支援 X-API-Key header 或 Authorization: ApiKey <key>
  let rawKey = ctx.requestHeaders['x-api-key'] ?? ctx.requestHeaders['X-API-Key'] ?? ''
  if (!rawKey) {
    const auth = ctx.requestHeaders['authorization'] ?? ''
    if (auth.toLowerCase().startsWith('apikey ')) rawKey = auth.slice(7).trim()
  }

  if (!rawKey) {
    abort(ctx, 401, 'missing API key')
    return
  }
  if (!rawKey.startsWith(API_KEY_PREFIX)) {
    abort(ctx, 401, 'invalid API key format')
    return
  }

  // 先查 Redis 快取（Subscription Service 已預熱）
  const hash = sha256Hex(rawKey)
  const cacheKey = `apikey:info:${hash}`
  try {
    const cached = await deps.redis.hgetall(cacheKey)
    if (cached && Object.keys(cached).length > 0) {
      if (cached['status'] !== 'active') {
        abort(ctx, 401, 'api key is not active')
        return
      }
      applyKeyInfo(ctx, cached)
      return
    }
  } catch {
    // Redis 故障 → fall through
  }

  // Cache miss → 呼叫 Subscription Service
  try {
    const resp = await fetch(`${config.SUBSCRIPTION_SERVICE_URL}/internal/keys/verify`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ key: rawKey }),
      signal:  AbortSignal.timeout(3000),
    })

    if (resp.status === 401) { abort(ctx, 401, 'invalid or revoked API key'); return }
    if (resp.status === 403) { abort(ctx, 403, 'subscription is not active'); return }
    if (!resp.ok) {
      if (deps.config['fail_open'] === 'true') return
      abort(ctx, 503, 'auth service unavailable')
      return
    }

    const info = await resp.json() as Record<string, unknown>
    ctx.clientId = String(info['key_id']          ?? '')
    ctx.apiId    = String(info['api_id']           ?? ctx.apiId)
    ctx.plan     = String(info['plan']             ?? '')
    ctx.requestHeaders['x-client-id']       = ctx.clientId
    ctx.requestHeaders['x-subscription-id'] = String(info['subscription_id'] ?? '')
    ctx.requestHeaders['x-org-id']          = String(info['organization_id'] ?? '')
  } catch (err: unknown) {
    deps.log.warn({ err }, 'api key verify error')
    if (deps.config['fail_open'] === 'true') return
    abort(ctx, 503, 'auth service unavailable')
  }
}

function applyKeyInfo(ctx: ExecContext, info: Record<string, string>): void {
  ctx.clientId = info['key_id']    ?? ''
  ctx.apiId    = info['api_id']    ?? ctx.apiId
  ctx.plan     = info['plan_name'] ?? ''
  ctx.requestHeaders['x-client-id'] = ctx.clientId
}

/** SHA-256(raw) → hex string（與 Go 端 hashKey 完全一致） */
function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}
