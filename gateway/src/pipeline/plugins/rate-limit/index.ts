/**
 * T10 Rate Limit Plugin — 生產級多策略速率限制
 *
 * config keys:
 *   strategy       = "sliding_window" | "fixed_window" | "token_bucket"  (預設 sliding_window)
 *   key_by         = "client_id" | "ip" | "user_id" | "api_key"           (預設 client_id)
 *   rpm            = "1000"        requests/minute
 *   rph            = "5000"        requests/hour     (可選)
 *   rpd            = "10000"       requests/day      (可選)
 *   burst_size     = "200"         token bucket 桶容量 (strategy=token_bucket 時有效)
 *   refill_rate    = "16.67"       token/sec         (策略 token_bucket，預設 rpm/60)
 *   use_plan_limits = "true"       若無 rpm/rpd 設定，自動從訂閱方案取得
 *   fail_open      = "true"        Redis 故障時放行  (預設 true)
 */

import type { ExecContext, PluginDeps } from '../../types.js'
import { abort } from '../../types.js'
import { slidingWindow } from './strategies/sliding-window.js'
import { fixedWindow }   from './strategies/fixed-window.js'
import { tokenBucket }   from './strategies/token-bucket.js'
import { resolvePlanLimits } from './plan-resolver.js'
import { applyRateLimitHeaders, type WindowInfo } from './headers.js'
import { parseIntCfg, parseFloatCfg } from './util.js'

type Strategy = 'sliding_window' | 'fixed_window' | 'token_bucket'

export async function rateLimit(ctx: ExecContext, deps: PluginDeps): Promise<void> {
  const cfg      = deps.config
  const strategy = (cfg['strategy'] ?? 'sliding_window') as Strategy
  const keyBy    = cfg['key_by'] ?? 'client_id'
  const keyValue = resolveKey(ctx, keyBy)

  // 是否使用訂閱方案限制
  const usePlanLimits = cfg['use_plan_limits'] === 'true'

  let rpm = parseIntCfg(cfg['rpm'])
  let rph = parseIntCfg(cfg['rph'])
  let rpd = parseIntCfg(cfg['rpd'])

  // 若未設定且啟用方案限制，動態查詢
  if (usePlanLimits && (!rpm || !rpd)) {
    const plan = await resolvePlanLimits(ctx.clientId, ctx.apiId, deps.redis)
    if (plan) {
      if (!rpm && plan.rpm > 0) rpm = plan.rpm
      if (!rph && plan.rph > 0) rph = plan.rph
      if (!rpd && plan.rpd > 0) rpd = plan.rpd
    }
  }

  if (!rpm && !rph && !rpd) return   // 無任何限制設定，直接通過

  const windows: WindowInfo[] = []
  let deniedWindow: WindowInfo | null = null

  // ─── 依策略執行各時間窗口 ──────────────────────────────────

  if (strategy === 'token_bucket') {
    // Token Bucket：以 rpm 計算 capacity & refill_rate
    const bucketCapacity  = parseIntCfg(cfg['burst_size']) ?? Math.ceil((rpm ?? 100) * 1.5)
    const refillRate      = parseFloatCfg(cfg['refill_rate'], (rpm ?? 100) / 60)
    const bucketKey       = `${keyValue}:${ctx.apiId}`

    const result = await tokenBucket(deps.redis, bucketKey, bucketCapacity, refillRate)
    const w: WindowInfo = {
      limit:     bucketCapacity,
      current:   bucketCapacity - result.tokensRemaining,
      windowMs:  60_000,
      resetAtMs: Date.now() + result.waitMs,
      period:    'minute',
    }
    windows.push(w)

    if (!result.allowed) {
      deniedWindow = w
      applyRateLimitHeaders(ctx.responseHeaders, windows, deniedWindow)
      abort(ctx, 429, `rate limit exceeded (token bucket)`)
      return
    }
  } else {
    // Sliding Window 或 Fixed Window

    if (rpm) {
      const w = await checkWindow(strategy, deps, `${keyValue}:${ctx.apiId}`, 'rpm', 60_000, 60, rpm)
      windows.push({ ...w, period: 'minute' })
      if (!w.allowed) deniedWindow = windows[windows.length - 1]!
    }

    if (!deniedWindow && rph) {
      const w = await checkWindow(strategy, deps, `${keyValue}:${ctx.apiId}`, 'rph', 3_600_000, 3600, rph)
      windows.push({ ...w, period: 'hour' })
      if (!w.allowed) deniedWindow = windows[windows.length - 1]!
    }

    if (!deniedWindow && rpd) {
      const w = await checkWindow(strategy, deps, `${keyValue}:${ctx.apiId}`, 'rpd', 86_400_000, 86400, rpd)
      windows.push({ ...w, period: 'day' })
      if (!w.allowed) deniedWindow = windows[windows.length - 1]!
    }
  }

  // 寫入 response headers（無論是否拒絕）
  applyRateLimitHeaders(ctx.responseHeaders, windows, deniedWindow)

  if (deniedWindow) {
    abort(ctx, 429, buildDeniedMessage(deniedWindow))
  }
}

// ─── helpers ─────────────────────────────────────────────────

async function checkWindow(
  strategy:  Strategy,
  deps:      PluginDeps,
  key:       string,
  period:    string,
  windowMs:  number,
  windowSec: number,
  limit:     number,
): Promise<Omit<WindowInfo, 'period'> & { allowed: boolean }> {
  if (strategy === 'fixed_window') {
    const r = await fixedWindow(deps.redis, `${period}:${key}`, windowSec, limit)
    return {
      allowed:   r.allowed,
      current:   r.current,
      limit:     r.limit,
      windowMs,
      resetAtMs: Date.now() + r.ttlRemainingSec * 1000,
    }
  } else {
    // sliding_window (default)
    const r = await slidingWindow(deps.redis, `${period}:${key}`, windowMs, limit)
    return {
      allowed:   r.allowed,
      current:   r.current,
      limit:     r.limit,
      windowMs:  r.windowMs,
      resetAtMs: r.resetAtMs,
    }
  }
}

function resolveKey(ctx: ExecContext, keyBy: string): string {
  switch (keyBy) {
    case 'ip':
      return ctx.remoteIp
    case 'user_id':
      return (ctx.claims['sub'] as string | undefined) ?? ctx.remoteIp
    case 'api_key':
      return (ctx.requestHeaders['x-api-key'] ?? ctx.clientId) || ctx.remoteIp
    default:   // client_id
      return ctx.clientId || ctx.remoteIp
  }
}

function buildDeniedMessage(w: WindowInfo): string {
  const label = { minute: 'per minute', hour: 'per hour', day: 'per day' }[w.period]
  return `rate limit exceeded: ${w.limit} requests ${label}`
}
