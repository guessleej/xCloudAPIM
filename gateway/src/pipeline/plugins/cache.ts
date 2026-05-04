import { createHash } from 'node:crypto'
import type { ExecContext, PluginDeps } from '../types.js'
import { abort } from '../types.js'

interface CacheEntry {
  status:  number
  headers: Record<string, string>
  body:    string   // base64
}

const CACHEABLE_METHODS = new Set(['GET', 'HEAD'])

export async function cache(ctx: ExecContext, deps: PluginDeps): Promise<void> {
  if (!CACHEABLE_METHODS.has(ctx.method.toUpperCase())) return

  // bypass on no-cache
  if (deps.config['bypass_if'] === 'no-cache') {
    const cc = (ctx.requestHeaders['cache-control'] ?? '').toLowerCase()
    if (cc.includes('no-cache') || cc.includes('no-store')) return
  }

  const ttlSec = parseInt(deps.config['ttl'] ?? '60', 10) || 60
  const cacheKey = buildKey(ctx, deps.config)

  // ─── pre_request: 嘗試命中 ────────────────────────────────
  if (ctx.statusCode === 0) {
    try {
      const raw = await deps.redis.get(cacheKey)
      if (raw) {
        const entry: CacheEntry = JSON.parse(raw)
        ctx.cacheHit      = true
        ctx.responseBody  = Buffer.from(entry.body, 'base64')
        ctx.statusCode    = entry.status
        for (const [k, v] of Object.entries(entry.headers)) {
          ctx.responseHeaders[k] = v
        }
        ctx.responseHeaders['x-cache'] = 'HIT'
        abort(ctx, entry.status, '')
      } else {
        ctx.responseHeaders['x-cache'] = 'MISS'
      }
    } catch { /* redis 故障，繼續 */ }
    return
  }

  // ─── post_response: 寫入快取 ──────────────────────────────
  if (ctx.statusCode >= 200 && ctx.statusCode < 300 && ctx.responseBody) {
    const entry: CacheEntry = {
      status:  ctx.statusCode,
      headers: ctx.responseHeaders,
      body:    ctx.responseBody.toString('base64'),
    }
    try {
      await deps.redis.set(cacheKey, JSON.stringify(entry), 'EX', ttlSec)
    } catch { /* 忽略 */ }
  }
}

function buildKey(ctx: ExecContext, cfg: Record<string, string>): string {
  const keyBy = cfg['key_by'] ?? 'path'
  const parts: string[] = ['cache', ctx.apiId, ctx.path]

  if (keyBy === 'path_method')         parts.push(ctx.method)
  if (keyBy === 'path_method_client')  parts.push(ctx.method, ctx.clientId)

  if (cfg['vary_headers']) {
    for (const h of cfg['vary_headers'].split(',').map((s) => s.trim())) {
      const v = ctx.requestHeaders[h.toLowerCase()]
      if (v) parts.push(`${h}=${v}`)
    }
  }

  const hash = createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 16)
  return `cache:${ctx.apiId}:${hash}`
}
