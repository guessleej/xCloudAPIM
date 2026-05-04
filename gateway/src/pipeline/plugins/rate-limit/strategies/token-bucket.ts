import type { Redis } from 'ioredis'
import { TOKEN_BUCKET } from '../lua-scripts.js'

export interface TokenBucketResult {
  allowed:        boolean
  tokensRemaining: number
  capacity:       number
  waitMs:         number   // 需要等待多少 ms 才能重試（denied 時有值）
}

/**
 * Token Bucket 速率限制（允許 burst）
 * @param capacity   桶容量（最大 burst size）
 * @param refillRate tokens/秒（持續補充速率）
 * @param requested  本次消費的 token 數（通常為 1）
 */
export async function tokenBucket(
  redis:      Redis,
  key:        string,
  capacity:   number,
  refillRate: number,
  requested = 1,
): Promise<TokenBucketResult> {
  const redisKey = `rl:tb:${key}`

  try {
    const raw = await redis.eval(
      TOKEN_BUCKET, 1,
      redisKey,
      String(capacity),
      String(refillRate),
      String(requested),
      String(Date.now()),
    ) as [number, number, number, number]

    const [tokens, cap, allowed, waitMs] = raw
    return {
      allowed:         allowed === 1,
      tokensRemaining: tokens,
      capacity:        cap,
      waitMs,
    }
  } catch {
    return { allowed: true, tokensRemaining: capacity, capacity, waitMs: 0 }
  }
}
