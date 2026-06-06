/**
 * SSRF Guard — 驗證上游（upstream）目標位址，防止閘道被當作 SSRF 跳板。
 * 對應 docs/security/02-threat-model.md（API7 SSRF）與 04-secure-coding-standards.md §1.6/§2.5。
 *
 * 策略：
 *  - 僅允許 http/https scheme。
 *  - 一律封鎖：loopback、link-local（含雲端 metadata 169.254.169.254）、未指定位址。
 *  - 可設定封鎖私有網段（RFC1918 / ULA / CGNAT）；生產預設封鎖。
 *  - 可設定嚴格 allow-list（UPSTREAM_ALLOWED_HOSTS）。
 *  - hostname 會經 DNS 解析後逐一檢查，防止以網域名繞過（含 DNS rebinding 的初步防護）。
 *  - 結果快取 60s，避免每次請求都 DNS 解析。
 */
import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import { config } from '../config/index.js'

const allowedHosts = new Set(
  config.UPSTREAM_ALLOWED_HOSTS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
)

function blockPrivateEnabled(): boolean {
  if (config.UPSTREAM_BLOCK_PRIVATE_IPS === 'true') return true
  if (config.UPSTREAM_BLOCK_PRIVATE_IPS === 'false') return false
  return config.NODE_ENV === 'production' // 'auto'
}

/** 判斷 IPv4 是否屬於應封鎖範圍 */
export function isBlockedIPv4(ip: string, blockPrivate: boolean): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true
  const [a, b] = parts as [number, number, number, number]
  // 一律封鎖
  if (a === 0) return true              // 0.0.0.0/8
  if (a === 127) return true            // loopback
  if (a === 169 && b === 254) return true // link-local + 雲端 metadata
  if (a === 255) return true            // broadcast
  // 私有範圍（可設定）
  if (blockPrivate) {
    if (a === 10) return true                         // 10/8
    if (a === 172 && b >= 16 && b <= 31) return true  // 172.16/12
    if (a === 192 && b === 168) return true           // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true // 100.64/10 CGNAT
  }
  return false
}

/** 判斷 IPv6 是否屬於應封鎖範圍 */
export function isBlockedIPv6(ip: string, blockPrivate: boolean): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (lower === '::1' || lower === '::') return true        // loopback / unspecified
  if (lower.startsWith('fe80')) return true                 // link-local
  if (lower.startsWith('::ffff:')) {                        // IPv4-mapped
    return isBlockedIPv4(lower.slice(7), blockPrivate)
  }
  if (blockPrivate && (lower.startsWith('fc') || lower.startsWith('fd'))) return true // ULA
  return false
}

export interface SsrfCheck {
  ok: boolean
  reason?: string
}

const cache = new Map<string, { result: SsrfCheck; at: number }>()
const CACHE_TTL_MS = 60_000

/** 檢查 upstream URL 是否允許轉發（含 DNS 解析，結果快取） */
export async function checkUpstream(urlStr: string, now: number = Date.now()): Promise<SsrfCheck> {
  const cached = cache.get(urlStr)
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.result
  const result = await evaluate(urlStr)
  cache.set(urlStr, { result, at: now })
  return result
}

async function evaluate(urlStr: string): Promise<SsrfCheck> {
  let url: URL
  try {
    url = new URL(urlStr)
  } catch {
    return { ok: false, reason: 'invalid url' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `scheme '${url.protocol}' not allowed` }
  }

  const host = url.hostname.toLowerCase()

  if (allowedHosts.size > 0) {
    const hostPort = url.port ? `${host}:${url.port}` : host
    if (!allowedHosts.has(host) && !allowedHosts.has(hostPort)) {
      return { ok: false, reason: `host '${host}' not in allow-list` }
    }
  }

  const blockPrivate = blockPrivateEnabled()
  const bareHost = host.replace(/^\[|\]$/g, '')

  let ips: string[]
  if (isIP(bareHost)) {
    ips = [bareHost]
  } else {
    try {
      const records = await lookup(host, { all: true })
      ips = records.map((r) => r.address)
    } catch {
      return { ok: false, reason: `dns resolve failed for '${host}'` }
    }
  }

  if (ips.length === 0) return { ok: false, reason: `no address for '${host}'` }

  for (const ip of ips) {
    const blocked = isIP(ip) === 6 ? isBlockedIPv6(ip, blockPrivate) : isBlockedIPv4(ip, blockPrivate)
    if (blocked) return { ok: false, reason: `resolved ip '${ip}' is blocked` }
  }

  return { ok: true }
}

/** 測試用：清除快取 */
export function _resetCache(): void {
  cache.clear()
}
