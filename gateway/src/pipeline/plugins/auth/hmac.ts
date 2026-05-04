/**
 * HMAC Signature Auth（Webhook / 服務對服務）
 * 驗證 X-Signature-256: sha256=<hmac> 或 X-Hub-Signature-256（GitHub 風格）
 *
 * config keys:
 *   secret          = "webhook-shared-secret"  (HMAC-SHA256 金鑰)
 *   header_name     = "x-signature-256"         (含 signature 的 header，預設)
 *   prefix          = "sha256="                 (hash 前綴，預設)
 *   max_body_bytes  = "65536"                   (最大驗簽 body 大小，預設 64KB)
 *   timestamp_header = "x-timestamp"            (可選，防重播攻擊)
 *   timestamp_tolerance_s = "300"               (時間戳容忍秒數，預設 5 分鐘)
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ExecContext, PluginDeps } from '../../types.js'

export async function hmacAuth(
  ctx:  ExecContext,
  deps: PluginDeps,
): Promise<{ ok: boolean; reason?: string }> {
  const cfg = deps.config
  const secret = cfg['secret']
  if (!secret) return { ok: false, reason: 'HMAC secret not configured' }

  const headerName = (cfg['header_name'] ?? 'x-signature-256').toLowerCase()
  const prefix     = cfg['prefix'] ?? 'sha256='
  const sigHeader  = ctx.requestHeaders[headerName] ?? ctx.requestHeaders['x-hub-signature-256'] ?? ''

  if (!sigHeader) return { ok: false, reason: `missing ${headerName} header` }

  // 可選：時間戳防重播
  const tsHeader = cfg['timestamp_header']
  if (tsHeader) {
    const ts = parseInt(ctx.requestHeaders[tsHeader.toLowerCase()] ?? '0', 10)
    const tolerance = parseInt(cfg['timestamp_tolerance_s'] ?? '300', 10)
    if (!ts || Math.abs(Date.now() / 1000 - ts) > tolerance) {
      return { ok: false, reason: 'request timestamp expired or missing' }
    }
  }

  // Body 取得
  const maxBytes = parseInt(cfg['max_body_bytes'] ?? '65536', 10)
  const body = ctx.requestBody ?? Buffer.alloc(0)
  if (body.length > maxBytes) {
    return { ok: false, reason: `body exceeds max signature verification size (${maxBytes} bytes)` }
  }

  // 簽章驗證
  const rawSig = sigHeader.startsWith(prefix) ? sigHeader.slice(prefix.length) : sigHeader
  const expected = createHmac('sha256', secret).update(body).digest('hex')

  let expectedBuf: Buffer
  let actualBuf:   Buffer
  try {
    expectedBuf = Buffer.from(expected, 'hex')
    actualBuf   = Buffer.from(rawSig, 'hex')
  } catch {
    return { ok: false, reason: 'invalid signature encoding' }
  }

  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return { ok: false, reason: 'HMAC signature mismatch' }
  }

  // 注入辨識資訊
  const serviceId = ctx.requestHeaders['x-service-id'] ?? ctx.requestHeaders['x-client-id'] ?? ''
  if (serviceId) {
    ctx.clientId = serviceId
    ctx.requestHeaders['x-client-id'] = serviceId
  }

  return { ok: true }
}
