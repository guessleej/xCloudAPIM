import { fetch } from 'undici'
import type { Redis } from 'ioredis'
import type { FastifyBaseLogger } from 'fastify'
import { config } from '../config/index.js'
import { internalHeaders } from '../plugins/internal-token.js'

export interface RouteEntry {
  id?:         string
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

type RegistryRoutePayload = Omit<Partial<RouteEntry>, 'host' | 'methods'> & {
  api_id?: string
  upstream_url?: string
  strip_prefix?: string
  api_version?: string
  host?: string | null
  host_match?: string | null
  path_prefix?: string
  methods?: string[] | null
  active?: boolean
}

// ─── In-memory Route Table ────────────────────────────────────

let routes: RouteEntry[] = []
let lastSyncAt = 0

const REDIS_KEY = 'gateway:routes'

/**
 * 根據 host + path + method 找到最長前綴匹配的路由
 * 優先順序：host exact > path length desc > method exact
 */
export function matchRoute(
  host: string,
  path: string,
  method: string,
): RouteEntry | null {
  const normalizedHost = normalizeHost(host)
  const normalizedPath = normalizePath(path)
  const normalizedMethod = method.toUpperCase()

  const candidates = routes.filter((r) => {
    if (!r.active) return false
    if (r.host && r.host !== normalizedHost) return false
    if (r.methods.length > 0 && !r.methods.includes(normalizedMethod)) return false
    return matchesPathPrefix(normalizedPath, r.pathPrefix)
  })

  if (candidates.length === 0) return null

  candidates.sort((a, b) => {
    const hostSpecificity = Number(Boolean(b.host)) - Number(Boolean(a.host))
    if (hostSpecificity !== 0) return hostSpecificity

    const pathSpecificity = b.pathPrefix.length - a.pathPrefix.length
    if (pathSpecificity !== 0) return pathSpecificity

    return Number(b.methods.length > 0) - Number(a.methods.length > 0)
  })
  return candidates[0]!
}

// ─── Sync ─────────────────────────────────────────────────────

export async function syncRoutes(redis: Redis, log: FastifyBaseLogger): Promise<void> {
  try {
    const since = lastSyncAt
    const url = `${config.REGISTRY_SERVICE_URL}/internal/routes/delta?since=${since}`
    const resp = await fetch(url, { headers: internalHeaders(), signal: AbortSignal.timeout(5000) })

    if (!resp.ok) {
      log.warn({ status: resp.status }, 'route sync failed')
      return
    }

    const data = await resp.json() as { routes: RegistryRoutePayload[] }
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
      routes = normalizeRoutes(JSON.parse(cached) as RegistryRoutePayload[])
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
    const resp = await fetch(url, { headers: internalHeaders(), signal: AbortSignal.timeout(10_000) })
    if (!resp.ok) return

    const data = await resp.json() as { routes: RegistryRoutePayload[] }
    if (!Array.isArray(data.routes)) return

    routes = normalizeRoutes(data.routes).filter((r) => r.active)
    lastSyncAt = Math.floor(Date.now() / 1000)

    await redis.set(REDIS_KEY, JSON.stringify(routes), 'EX', config.ROUTE_CACHE_TTL_S)
    log.info({ count: routes.length }, 'routes full sync completed')
  } catch (err) {
    log.warn({ err }, 'route full sync error')
  }
}

function applyDelta(delta: RegistryRoutePayload[]): void {
  for (const payload of delta) {
    const r = normalizeRoute(payload)
    if (!r) continue

    const key = routeIdentityKey(r)
    const idx = routes.findIndex((x) => routeIdentityKey(x) === key)
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

function normalizeRoutes(next: RegistryRoutePayload[]): RouteEntry[] {
  return next
    .map((route) => normalizeRoute(route))
    .filter((route): route is RouteEntry => route !== null)
}

function normalizeRoute(route: RegistryRoutePayload): RouteEntry | null {
  const apiId = route.apiId ?? route.api_id
  const pathPrefix = route.pathPrefix ?? route.path_prefix
  const upstreamUrl = route.upstreamUrl ?? route.upstream_url

  if (!apiId || !pathPrefix || !upstreamUrl) return null

  return {
    id: route.id,
    apiId,
    upstreamUrl,
    stripPrefix: route.stripPrefix ?? route.strip_prefix ?? '',
    active: route.active ?? false,
    version: route.version ?? route.api_version ?? '',
    host: normalizeHost(route.host ?? route.host_match ?? ''),
    pathPrefix: normalizePathPrefix(pathPrefix),
    methods: normalizeMethods(route.methods ?? []),
  }
}

function normalizeHost(host: string): string | undefined {
  const trimmed = host.trim().toLowerCase()
  if (!trimmed) return undefined
  if (trimmed.startsWith('[')) return trimmed
  return trimmed.split(':')[0]
}

function normalizePath(path: string): string {
  const pathname = path.split('?')[0] || '/'
  return pathname.startsWith('/') ? pathname : `/${pathname}`
}

function normalizePathPrefix(prefix: string): string {
  const normalized = normalizePath(prefix)
  if (normalized === '/') return normalized
  return normalized.replace(/\/+$/, '')
}

function normalizeMethods(methods: string[] | null): string[] {
  if (!methods || methods.length === 0) return []
  return [...new Set(methods.map((method) => method.toUpperCase()).filter(Boolean))].sort()
}

function matchesPathPrefix(path: string, prefix: string): boolean {
  return prefix === '/' || path === prefix || path.startsWith(`${prefix}/`)
}

function routeIdentityKey(route: RouteEntry): string {
  return [
    route.apiId,
    route.host ?? '*',
    route.pathPrefix,
    route.methods.length > 0 ? route.methods.join(',') : '*',
    route.version,
  ].join('\u0000')
}

export function replaceRoutesForTest(next: RegistryRoutePayload[]): void {
  routes = normalizeRoutes(next)
}

export function applyDeltaForTest(delta: RegistryRoutePayload[]): void {
  applyDelta(delta)
}

export function resetRoutesForTest(): void {
  routes = []
  lastSyncAt = 0
}
