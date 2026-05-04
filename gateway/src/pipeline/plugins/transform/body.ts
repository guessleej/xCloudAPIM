/**
 * Body 轉換
 *
 * config keys:
 *   request_body_ops   = '[{"op":"set","path":"$.traceId","value":"${uuid}"},...]'
 *   response_body_ops  = '[{"op":"wrap","key":"data"},...]'
 *   request_body_type  = "json" | "passthrough"   (預設 json)
 *   response_body_type = "json" | "passthrough"
 *   max_body_bytes     = "1048576"                (1MB，超過跳過轉換)
 */
import type { ExecContext } from '../../types.js'
import { applyJsonOps, parseJsonOps } from './json-ops.js'

const DEFAULT_MAX_BYTES = 1_048_576

export function transformRequestBody(ctx: ExecContext, cfg: Record<string, string>): void {
  const raw = cfg['request_body_ops']
  if (!raw) return

  const bodyType = cfg['request_body_type'] ?? 'json'
  if (bodyType !== 'json') return

  const body = ctx.requestBody
  if (!body || body.length === 0) return

  const maxBytes = parseInt(cfg['max_body_bytes'] ?? String(DEFAULT_MAX_BYTES), 10)
  if (body.length > maxBytes) return

  const contentType = (ctx.requestHeaders['content-type'] ?? '').toLowerCase()
  if (!contentType.includes('application/json')) return

  try {
    const obj = JSON.parse(body.toString('utf-8')) as Record<string, unknown>
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return

    const ops    = parseJsonOps(raw)
    const result = applyJsonOps(obj, ops, ctx)
    ctx.requestBody = Buffer.from(JSON.stringify(result), 'utf-8')
    ctx.requestHeaders['content-length'] = String(ctx.requestBody.length)
  } catch { /* malformed JSON — skip */ }
}

export function transformResponseBody(ctx: ExecContext, cfg: Record<string, string>): void {
  const raw = cfg['response_body_ops']
  if (!raw) return

  const bodyType = cfg['response_body_type'] ?? 'json'
  if (bodyType !== 'json') return

  const body = ctx.responseBody
  if (!body || body.length === 0) return

  const maxBytes = parseInt(cfg['max_body_bytes'] ?? String(DEFAULT_MAX_BYTES), 10)
  if (body.length > maxBytes) return

  const contentType = (ctx.responseHeaders['content-type'] ?? '').toLowerCase()
  if (!contentType.includes('application/json')) return

  try {
    const obj = JSON.parse(body.toString('utf-8')) as Record<string, unknown>
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return

    const ops    = parseJsonOps(raw)
    const result = applyJsonOps(obj, ops, ctx)
    const newBody = Buffer.from(JSON.stringify(result), 'utf-8')
    ctx.responseBody = newBody
    ctx.responseHeaders['content-length'] = String(newBody.length)
  } catch { /* malformed JSON — skip */ }
}
