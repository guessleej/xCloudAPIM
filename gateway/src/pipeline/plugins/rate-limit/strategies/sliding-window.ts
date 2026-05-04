import type { Redis } from 'ioredis'
import { SLIDING_WINDOW } from '../lua-scripts.js'
import { randomReqId } from '../util.js'

export interface SlidingWindowResult {
  allowed:    boolean
  current:    number
  limit:      number
  windowMs:   number
  resetAtMs:  number    // earliest slot 離開 window 的時間 → reset 時間點
}

/**
 * 原子性 Sliding Window 速率限制
 * @param redis  Redis 客戶端
 * @param key    Redis key（不含前綴）
 * @param windowMs 窗口大小（毫秒）
 * @param limit  窗口內允許的最大請求數
 */
export async function slidingWindow(
  redis:    Redis,
  key:      string,
  windowMs: number,
  limit:    number,
): Promise<SlidingWindowResult> {
  const nowMs = Date.now()
  const reqId = randomReqId()
  const redisKey = `rl:sw:${key}`

  try {
    const raw = await redis.eval(
      SLIDING_WINDOW, 1,
      redisKey,
      String(windowMs),
      String(limit),
      String(nowMs),
      reqId,
    ) as [number, number, number, number, number]

    const [current, , , allowed, oldestMs] = raw
    const resetAtMs = oldestMs > 0
      ? oldestMs + windowMs          // oldest record 滑出 window 的時間
      : nowMs + windowMs

    return { allowed: allowed === 1, current, limit, windowMs, resetAtMs }
  } catch {
    // fail-open：Redis 故障時放行
    return { allowed: true, current: 0, limit, windowMs, resetAtMs: nowMs + windowMs }
  }
}
