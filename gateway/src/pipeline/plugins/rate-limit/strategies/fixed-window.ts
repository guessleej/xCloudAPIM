import type { Redis } from 'ioredis'
import { FIXED_WINDOW } from '../lua-scripts.js'

export interface FixedWindowResult {
  allowed:       boolean
  current:       number
  limit:         number
  windowSec:     number
  ttlRemainingSec: number   // 此窗口剩餘秒數
}

/**
 * Fixed Window 速率限制（INCR + EXPIRE）
 * key 中嵌入窗口 ID 確保每個窗口獨立計數。
 */
export async function fixedWindow(
  redis:     Redis,
  key:       string,
  windowSec: number,
  limit:     number,
): Promise<FixedWindowResult> {
  const windowId = Math.floor(Date.now() / (windowSec * 1000))
  const redisKey = `rl:fw:${key}:${windowId}`

  try {
    const raw = await redis.eval(
      FIXED_WINDOW, 1,
      redisKey,
      String(limit),
      String(windowSec),
    ) as [number, number, number, number]

    const [current, , allowed, ttl] = raw
    return {
      allowed:         allowed === 1,
      current,
      limit,
      windowSec,
      ttlRemainingSec: Math.max(0, ttl),
    }
  } catch {
    return { allowed: true, current: 0, limit, windowSec, ttlRemainingSec: windowSec }
  }
}
