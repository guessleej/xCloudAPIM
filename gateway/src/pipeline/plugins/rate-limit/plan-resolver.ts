import { fetch } from 'undici'
import { config as appConfig } from '../../../config/index.js'
import type { Redis } from 'ioredis'

export interface PlanLimits {
  rpm:  number    // -1 = unlimited
  rph:  number
  rpd:  number
  burst: number   // burst_multiplier * rpm
  plan: string
}

const PLAN_CACHE_TTL_MS = 5 * 60 * 1000   // 5 分鐘本地快取

interface CacheEntry { limits: PlanLimits; fetchedAt: number }
const localCache = new Map<string, CacheEntry>()

/**
 * 取得客戶端的方案限制。
 * 查詢順序：本地 Map → Redis Hash → Subscription Service HTTP
 */
export async function resolvePlanLimits(
  clientId: string,
  apiId:    string,
  redis:    Redis,
): Promise<PlanLimits | null> {
  if (!clientId || !apiId) return null

  const cacheKey = `${clientId}:${apiId}`

  // L1 本地記憶體快取
  const local = localCache.get(cacheKey)
  if (local && Date.now() - local.fetchedAt < PLAN_CACHE_TTL_MS) {
    return local.limits
  }

  // L2 Redis（Subscription Service 已預熱的 apikey:info hash）
  const redisKey = `apikey:info:${clientId}`
  try {
    const info = await redis.hgetall(redisKey)
    if (info && info['rpm_limit']) {
      const limits = mapInfoToLimits(info)
      localCache.set(cacheKey, { limits, fetchedAt: Date.now() })
      return limits
    }
  } catch { /* fall through */ }

  // L3 Subscription Service HTTP
  try {
    const url = `${appConfig.SUBSCRIPTION_SERVICE_URL}/internal/quota/check?client_id=${encodeURIComponent(clientId)}&api_id=${encodeURIComponent(apiId)}`
    const resp = await fetch(url, { signal: AbortSignal.timeout(2000) })
    if (!resp.ok) return null

    const data = await resp.json() as {
      rpm_limit?:   number
      rpd_limit?:   number
      plan?:        string
    }

    const limits: PlanLimits = {
      rpm:   data.rpm_limit  ?? -1,
      rph:   -1,
      rpd:   data.rpd_limit  ?? -1,
      burst: Math.ceil((data.rpm_limit ?? 0) * 1.5),
      plan:  data.plan ?? '',
    }
    localCache.set(cacheKey, { limits, fetchedAt: Date.now() })
    return limits
  } catch {
    return null
  }
}

function mapInfoToLimits(info: Record<string, string>): PlanLimits {
  const rpm = parseInt(info['rpm_limit'] ?? '-1', 10)
  const rpd = parseInt(info['rpd_limit'] ?? '-1', 10)
  return {
    rpm,
    rph:   -1,
    rpd,
    burst: rpm > 0 ? Math.ceil(rpm * 1.5) : -1,
    plan:  info['plan_name'] ?? '',
  }
}
