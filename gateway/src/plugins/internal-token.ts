import { createHash } from 'node:crypto'
import { config } from '../config/index.js'

let _cachedToken: string | null = null

/**
 * 計算 X-Internal-Token（SHA-256 of INTERNAL_SERVICE_SECRET）
 * 與 Go 服務端的 middleware/internal_auth.go 邏輯對齊
 */
export function getInternalToken(): string {
  if (_cachedToken) return _cachedToken
  if (!config.INTERNAL_SERVICE_SECRET) {
    throw new Error('INTERNAL_SERVICE_SECRET is not set — cannot call internal services')
  }
  _cachedToken = createHash('sha256').update(config.INTERNAL_SERVICE_SECRET).digest('hex')
  return _cachedToken
}

/** 回傳帶有 X-Internal-Token 的 headers 物件 */
export function internalHeaders(): Record<string, string> {
  return { 'x-internal-token': getInternalToken() }
}
