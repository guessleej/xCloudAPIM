import type { ExecContext, PluginDeps } from '../types.js'
import { abort } from '../types.js'

type CBState = 'closed' | 'open' | 'half_open'

export async function circuitBreaker(ctx: ExecContext, deps: PluginDeps): Promise<void> {
  const threshold    = parseInt(deps.config['threshold']      ?? '5',  10)
  const timeoutSec   = parseInt(deps.config['timeout']        ?? '30', 10)
  const halfOpenMax  = parseInt(deps.config['half_open_max']  ?? '2',  10)
  const windowSec    = parseInt(deps.config['window']         ?? '60', 10)
  const errThreshold = parseInt(deps.config['error_threshold'] ?? '50', 10)

  const apiId     = ctx.apiId
  const stateKey  = `cb:state:${apiId}`
  const openAtKey = `cb:open_at:${apiId}`
  const failKey   = `cb:fail:${apiId}`
  const totalKey  = `cb:total:${apiId}`
  const halfKey   = `cb:half:${apiId}`

  const stateVal = await deps.redis.get(stateKey)
  const state: CBState = (stateVal === 'open' || stateVal === 'half_open')
    ? stateVal
    : 'closed'

  if (state === 'open') {
    const openAt = parseInt((await deps.redis.get(openAtKey)) ?? '0', 10)
    const nowSec = Math.floor(Date.now() / 1000)
    if (nowSec - openAt >= timeoutSec) {
      // open → half_open
      await deps.redis.set(stateKey, 'half_open')
      await deps.redis.del(halfKey)
      ctx.requestHeaders['x-circuit-breaker'] = 'half_open'
      return
    }
    abort(ctx, 503, 'circuit breaker open: service unavailable')
    return
  }

  if (state === 'half_open') {
    const count = await deps.redis.incr(halfKey)
    await deps.redis.expire(halfKey, timeoutSec)
    if (count > halfOpenMax) {
      abort(ctx, 503, 'circuit breaker half-open: probe limit reached')
      return
    }
    ctx.requestHeaders['x-circuit-breaker'] = 'half_open_probe'
    return
  }

  // closed: post_response フェーズで結果を記録
  if (ctx.statusCode === 0) return // まだ upstream 呼び出し前

  await deps.redis.incr(totalKey)
  await deps.redis.expire(totalKey, windowSec)

  if (ctx.statusCode >= 500) {
    const fails = await deps.redis.incr(failKey)
    await deps.redis.expire(failKey, windowSec)

    const total = parseInt((await deps.redis.get(totalKey)) ?? '1', 10)
    const failRate = Math.floor((fails / total) * 100)

    if (fails >= threshold || failRate >= errThreshold) {
      await Promise.all([
        deps.redis.set(stateKey, 'open'),
        deps.redis.set(openAtKey, String(Math.floor(Date.now() / 1000))),
        deps.redis.del(failKey),
        deps.redis.del(totalKey),
      ])
    }
  } else if (ctx.requestHeaders['x-circuit-breaker'] === 'half_open_probe') {
    // 探測成功 → 重置為 closed
    await Promise.all([
      deps.redis.set(stateKey, 'closed'),
      deps.redis.del(failKey, totalKey, halfKey, openAtKey),
    ])
  }
}
