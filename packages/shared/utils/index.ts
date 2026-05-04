// ─── 共用工具函式 ─────────────────────────────────────────────

export const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

export const generateRequestId = (): string =>
  `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

export const isExpired = (expTimestamp: number): boolean =>
  Date.now() / 1000 > expTimestamp

export const maskSensitiveField = (value: string, visibleChars = 4): string => {
  if (value.length <= visibleChars) return '***'
  return `${'*'.repeat(value.length - visibleChars)}${value.slice(-visibleChars)}`
}

export const parseRateLimitHeaders = (headers: Record<string, string>) => ({
  limit:     parseInt(headers['x-ratelimit-limit']     ?? '0'),
  remaining: parseInt(headers['x-ratelimit-remaining'] ?? '0'),
  reset:     parseInt(headers['x-ratelimit-reset']     ?? '0'),
  retryAfter: headers['retry-after'] ? parseInt(headers['retry-after']) : undefined,
})

export const buildRateLimitKey = (
  strategy: 'ip' | 'client_id' | 'user_id',
  value: string,
  apiId: string,
  windowMs: number
): string => {
  const window = Math.floor(Date.now() / windowMs)
  return `rl:${strategy}:${value}:${apiId}:${window}`
}
