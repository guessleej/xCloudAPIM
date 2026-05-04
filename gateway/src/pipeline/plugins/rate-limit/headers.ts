/**
 * RFC 6585 + IETF draft-ietf-httpapi-ratelimit-headers 標準 header 工具
 *
 * 草案格式（建議採用）：
 *   RateLimit-Limit:     <limit> [, <limit>;w=<window_sec>]
 *   RateLimit-Remaining: <remaining>
 *   RateLimit-Reset:     <seconds_until_reset>
 *   Retry-After:         <seconds>            (僅拒絕時)
 *
 * 舊式格式（向後相容）：
 *   X-RateLimit-Limit-Minute:     <limit>
 *   X-RateLimit-Remaining-Minute: <remaining>
 *   X-RateLimit-Limit-Day:        <limit>
 *   X-RateLimit-Remaining-Day:    <remaining>
 */

export interface WindowInfo {
  limit:       number
  current:     number
  windowMs:    number
  resetAtMs:   number
  period:      'minute' | 'hour' | 'day'
}

export function applyRateLimitHeaders(
  headers:    Record<string, string>,
  windows:    WindowInfo[],
  denied:     WindowInfo | null,
): void {
  if (windows.length === 0) return

  // 選最嚴格的窗口（remaining 最少的）作為 RateLimit-* 主要 header
  const primary = windows.reduce((min, w) =>
    remaining(w) < remaining(min) ? w : min,
  )

  const remainingVal = Math.max(0, remaining(primary))
  const resetSec     = Math.max(0, Math.ceil((primary.resetAtMs - Date.now()) / 1000))

  // RFC draft headers
  headers['ratelimit-limit']     = formatLimit(primary)
  headers['ratelimit-remaining'] = String(remainingVal)
  headers['ratelimit-reset']     = String(resetSec)

  // 舊式 X-RateLimit-* headers（向後相容）
  for (const w of windows) {
    const rem  = Math.max(0, remaining(w))
    const pfx  = periodLabel(w.period)
    headers[`x-ratelimit-limit-${pfx}`]     = String(w.limit)
    headers[`x-ratelimit-remaining-${pfx}`] = String(rem)
  }

  // Retry-After（僅拒絕時）
  if (denied) {
    const retryAfterSec = Math.max(1, Math.ceil((denied.resetAtMs - Date.now()) / 1000))
    headers['retry-after'] = String(retryAfterSec)
  }
}

// ─── helpers ─────────────────────────────────────────────────

function remaining(w: WindowInfo): number {
  return w.limit - w.current
}

function formatLimit(w: WindowInfo): string {
  const windowSec = Math.ceil(w.windowMs / 1000)
  return `${w.limit};w=${windowSec}`
}

function periodLabel(p: WindowInfo['period']): string {
  return { minute: 'minute', hour: 'hour', day: 'day' }[p]
}
