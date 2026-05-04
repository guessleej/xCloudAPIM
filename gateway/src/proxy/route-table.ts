import { fetch } from 'undici'
import type { Redis } from 'ioredis'
import type { FastifyBaseLogger } from 'fastify'
import { config } from '../config/index.js'

export interface RouteEntry {
  apiId:       string
  upstreamUrl: string
  stripPrefix: string
  active:      boolean
  version:     string
  // 匹配條件
  host?:       string
  pathPrefix:  string
  methods:     string[]  // [] = all
}

// ─── In-memory Route Table ────────────────────────────────────

let routes: RouteEntry[] = []
let lastSyncAt = 0

const REDIS_KEY = 'gateway:routes'

/**
 * 根據 host + path + method 找到最長前綴匹配的路由
 * 優先順序：host exact > path length desc
 */
export function matchRoute(
  host: string,
  path: string,
  method: string,
): RouteEntry | null {
  const candidates = routes.filter((r) => {
    if (!r.active) return false
    if (r.host && r.host !== host) return false
    if (r.methods.length > 0 && !r.methods.includes(method.toUpperCase())) return false
    return path.startsWith(r.pathPrefix)
  })

  if (candidates.length === 0) return null

  // 最長前綴匹配
  candidates.sort((a, b) => b.pathPrefix.length - a.pathPrefix.length)
  return candidates[0]!
}

// ─── Sync ─────────────────────────────────────────────────────

export async function syncRoutes(redis: Redis, log: FastifyBaseLogger): Promise<void> {
  try {
    const since = lastSyncAt
    const url = `${config.REGISTRY_SERVICE_URL}/internal/routes/delta?since=${since}`
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) })

    if (!resp.ok) {
      log.warn({ status: resp.status }, 'route sync failed')
      return
    }

    const data = await resp.json() as { routes: RouteEntry[] }
    if (!Array.isArray(data.routes)) return

    applyDelta(data.routes)
    lastSyncAt = Math.floor(Date.now() / 1000)

    // 持久化至 Redis（重啟後快速恢復）
    if (routes.length > 0) {
      await redis.set(REDIS_KEY, JSON.stringify(routes), 'EX', config.ROUTE_CACHE_TTL_S)
    }

    log.debug({ count: routes.length, delta: data.routes.length }, 'routes synced')
  } catch (err) {
    log.warn({ err }, 'route sync error')
  }
}

/** 首次啟動：先從 Redis 載入，避免等待第一次 sync */
export async function loadFromCache(redis: Redis, log: FastifyBaseLogger): Promise<void> {
  try {
    const cached = await redis.get(REDIS_KEY)
    if (cached) {
      routes = JSON.parse(cached) as RouteEntry[]
      log.info({ count: routes.length }, 'routes loaded from redis cache')
    }
  } catch (err) {
    log.warn({ err }, 'route cache load error')
  }
}

/** 全量同步（首次啟動、或 delta sync 失敗累積太多時） */
export async function fullSync(redis: Redis, log: FastifyBaseLogger): Promise<void> {
  try {
    const url = `${config.REGISTRY_SERVICE_URL}/internal/routes/delta?since=0`
    const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!resp.ok) return

    const data = await resp.json() as { routes: RouteEntry[] }
    if (!Array.isArray(data.routes)) return

    routes = data.routes.filter((r) => r.active)
    lastSyncAt = Math.floor(Date.now() / 1000)

    await redis.set(REDIS_KEY, JSON.stringify(routes), 'EX', config.ROUTE_CACHE_TTL_S)
    log.info({ count: routes.length }, 'routes full sync completed')
  } catch (err) {
    log.warn({ err }, 'route full sync error')
  }
}

function applyDelta(delta: RouteEntry[]): void {
  for (const r of delta) {
    const idx = routes.findIndex((x) => x.apiId === r.apiId)
    if (!r.active) {
      if (idx >= 0) routes.splice(idx, 1)
    } else if (idx >= 0) {
      routes[idx] = r
    } else {
      routes.push(r)
    }
  }
}

export function getRouteCount(): number {
  return routes.length
}
