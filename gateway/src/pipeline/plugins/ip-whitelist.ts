import type { ExecContext, PluginDeps } from '../types.js'
import { abort } from '../types.js'

export async function ipWhitelist(ctx: ExecContext, deps: PluginDeps): Promise<void> {
  const mode   = deps.config['mode'] ?? 'whitelist'
  const ipList = (deps.config['ips'] ?? '').split(',').map((s) => s.trim()).filter(Boolean)

  // 解析客戶端真實 IP
  let clientIp = ctx.requestHeaders['x-forwarded-for'] ?? ctx.requestHeaders['x-real-ip'] ?? ctx.remoteIp
  const commaIdx = clientIp.indexOf(',')
  if (commaIdx >= 0) clientIp = clientIp.slice(0, commaIdx).trim()

  if (!clientIp) {
    abort(ctx, 400, 'invalid client IP address')
    return
  }

  const matched = ipList.some((entry) => ipMatches(clientIp, entry))

  if (mode === 'whitelist' && !matched) {
    abort(ctx, 403, 'access denied: IP not in whitelist')
  } else if (mode === 'blacklist' && matched) {
    abort(ctx, 403, 'access denied: IP is blacklisted')
  }
}

function ipMatches(clientIp: string, entry: string): boolean {
  if (entry.includes('/')) {
    return cidrContains(entry, clientIp)
  }
  return entry === clientIp
}

/** 簡易 IPv4 CIDR 判斷（不依賴外部套件） */
function cidrContains(cidr: string, ip: string): boolean {
  const [range, bits] = cidr.split('/')
  const mask = ~((1 << (32 - parseInt(bits!, 10))) - 1) >>> 0
  const ipInt   = ipToInt(ip)
  const rangeInt = ipToInt(range!)
  if (ipInt === null || rangeInt === null) return false
  return (ipInt & mask) === (rangeInt & mask)
}

function ipToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const nums = parts.map(Number)
  if (nums.some((n) => isNaN(n) || n < 0 || n > 255)) return null
  return ((nums[0]! << 24) | (nums[1]! << 16) | (nums[2]! << 8) | nums[3]!) >>> 0
}
