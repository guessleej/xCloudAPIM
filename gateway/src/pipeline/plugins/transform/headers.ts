/**
 * Header 轉換
 *
 * config DSL（JSON array 字串或分號分隔）：
 *   request_headers  = '[{"op":"set","name":"X-Forwarded-For","value":"${ctx.clientId}"},...]'
 *   response_headers = '[{"op":"remove","name":"X-Internal-Id"},...]'
 *
 * 操作：
 *   set    — 覆蓋或新增
 *   add    — 附加（多值，逗號分隔）
 *   remove — 刪除
 *   rename — 重命名（name → target）
 *   copy   — 複製到 target
 */
import type { ExecContext } from '../../types.js'
import { resolveTemplate }  from './variables.js'

interface HeaderOp {
  op:      'set' | 'add' | 'remove' | 'rename' | 'copy'
  name:    string
  value?:  string
  target?: string
}

export function transformRequestHeaders(ctx: ExecContext, cfg: Record<string, string>): void {
  const raw = cfg['request_headers']
  if (!raw) return
  const ops = parseOps(raw)
  applyOps(ctx.requestHeaders, ops, ctx)
}

export function transformResponseHeaders(ctx: ExecContext, cfg: Record<string, string>): void {
  const raw = cfg['response_headers']
  if (!raw) return
  const ops = parseOps(raw)
  applyOps(ctx.responseHeaders, ops, ctx)
}

function applyOps(
  headers: Record<string, string>,
  ops:     HeaderOp[],
  ctx:     ExecContext,
): void {
  for (const op of ops) {
    const name  = op.name.toLowerCase()
    const value = op.value != null ? resolveTemplate(op.value, ctx) : ''

    switch (op.op) {
      case 'set':
        headers[name] = value
        break

      case 'add': {
        const existing = headers[name]
        headers[name] = existing ? `${existing}, ${value}` : value
        break
      }

      case 'remove':
        delete headers[name]
        break

      case 'rename':
        if (op.target && headers[name] !== undefined) {
          headers[op.target.toLowerCase()] = headers[name]!
          delete headers[name]
        }
        break

      case 'copy':
        if (op.target && headers[name] !== undefined) {
          headers[op.target.toLowerCase()] = headers[name]!
        }
        break
    }
  }
}

function parseOps(raw: string): HeaderOp[] {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed as HeaderOp[]
  } catch { /* fall through to simple format */ }

  // 簡易格式：set:X-Foo:bar;remove:X-Internal
  return raw.split(';').flatMap((part) => {
    const trimmed = part.trim()
    if (!trimmed) return []
    const [op, name, ...rest] = trimmed.split(':')
    if (!op || !name) return []
    return [{ op: op as HeaderOp['op'], name, value: rest.join(':') || undefined }]
  })
}
