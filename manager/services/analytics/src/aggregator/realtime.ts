/**
 * 即時計數器（Redis）
 * Key schema:
 *   rt:rpm:<apiId>:<clientId>   INCR, EXPIRE 60s
 *   rt:rph:<apiId>:<clientId>   INCR, EXPIRE 3600s
 *   rt:rpd:<apiId>:<clientId>   INCR, EXPIRE 86400s
 *   rt:err:<apiId>              INCR, EXPIRE 60s
 */
import type { Redis } from 'ioredis'

export interface RealtimeStats {
  rpm:    number
  rph:    number
  rpd:    number
  errRpm: number
}

export async function incrRealtimeCounters(
  redis:    Redis,
  apiId:    string,
  clientId: string,
  isError:  boolean,
): Promise<void> {
  const pipe = redis.pipeline()
  const rpm = `rt:rpm:${apiId}:${clientId}`
  const rph = `rt:rph:${apiId}:${clientId}`
  const rpd = `rt:rpd:${apiId}:${clientId}`
  const errKey = `rt:err:${apiId}`

  pipe.incr(rpm).expire(rpm, 60)
  pipe.incr(rph).expire(rph, 3600)
  pipe.incr(rpd).expire(rpd, 86400)
  if (isError) pipe.incr(errKey).expire(errKey, 60)

  await pipe.exec()
}

export async function getRealtimeStats(
  redis:    Redis,
  apiId:    string,
  clientId: string,
): Promise<RealtimeStats> {
  const [rpm, rph, rpd, errRpm] = await redis.mget(
    `rt:rpm:${apiId}:${clientId}`,
    `rt:rph:${apiId}:${clientId}`,
    `rt:rpd:${apiId}:${clientId}`,
    `rt:err:${apiId}`,
  )
  return {
    rpm:    parseInt(rpm ?? '0', 10),
    rph:    parseInt(rph ?? '0', 10),
    rpd:    parseInt(rpd ?? '0', 10),
    errRpm: parseInt(errRpm ?? '0', 10),
  }
}
