/**
 * JSON Body 操作（JSONPath 風格）
 *
 * 操作列表（JSON array）：
 *   [
 *     { "op": "set",    "path": "$.user.id",    "value": "${ctx.userId}" },
 *     { "op": "delete", "path": "$.internal" },
 *     { "op": "copy",   "from": "$.src",        "path": "$.dst" },
 *     { "op": "move",   "from": "$.old",        "path": "$.new" },
 *     { "op": "wrap",   "key":  "data"          },   // { data: <original> }
 *     { "op": "unwrap", "key":  "data"          },   // <original>.data
 *   ]
 *
 * Path 格式：$.key.nested 或 $.arr[0].field（只支援物件路徑，不支援 filter）
 */
import type { ExecContext } from '../../types.js'
import { resolveTemplate }  from './variables.js'

interface JsonOp {
  op:     'set' | 'delete' | 'copy' | 'move' | 'wrap' | 'unwrap'
  path?:  string
  from?:  string
  value?: unknown
  key?:   string
}

export function applyJsonOps(
  body:  Record<string, unknown>,
  ops:   JsonOp[],
  ctx:   ExecContext,
): Record<string, unknown> {
  let current = body

  for (const op of ops) {
    try {
      switch (op.op) {
        case 'set': {
          if (!op.path) break
          const val = typeof op.value === 'string'
            ? resolveTemplate(op.value, ctx)
            : op.value
          setPath(current, parsePath(op.path), val)
          break
        }

        case 'delete': {
          if (!op.path) break
          deletePath(current, parsePath(op.path))
          break
        }

        case 'copy': {
          if (!op.from || !op.path) break
          const val = getPath(current, parsePath(op.from))
          if (val !== undefined) setPath(current, parsePath(op.path), val)
          break
        }

        case 'move': {
          if (!op.from || !op.path) break
          const val = getPath(current, parsePath(op.from))
          if (val !== undefined) {
            setPath(current, parsePath(op.path), val)
            deletePath(current, parsePath(op.from))
          }
          break
        }

        case 'wrap': {
          const key = op.key ?? 'data'
          current = { [key]: current }
          break
        }

        case 'unwrap': {
          const key = op.key ?? 'data'
          const inner = current[key]
          if (inner !== null && typeof inner === 'object' && !Array.isArray(inner)) {
            current = inner as Record<string, unknown>
          }
          break
        }
      }
    } catch { /* ignore malformed path ops */ }
  }

  return current
}

export function parseJsonOps(raw: string): JsonOp[] {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed as JsonOp[]
  } catch {}
  return []
}

// ─── Path helpers ────────────────────────────────────────────────────────────

function parsePath(path: string): string[] {
  // $.foo.bar[0].baz  → ['foo', 'bar', '0', 'baz']
  return path
    .replace(/^\$\.?/, '')
    .split(/[.[\]]+/)
    .filter(Boolean)
}

function getPath(obj: Record<string, unknown>, keys: string[]): unknown {
  let cur: unknown = obj
  for (const k of keys) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

function setPath(obj: Record<string, unknown>, keys: string[], value: unknown): void {
  if (keys.length === 0) return
  let cur: Record<string, unknown> = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!
    if (cur[k] === null || typeof cur[k] !== 'object') {
      cur[k] = {}
    }
    cur = cur[k] as Record<string, unknown>
  }
  cur[keys[keys.length - 1]!] = value
}

function deletePath(obj: Record<string, unknown>, keys: string[]): void {
  if (keys.length === 0) return
  let cur: Record<string, unknown> = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!
    if (cur[k] === null || typeof cur[k] !== 'object') return
    cur = cur[k] as Record<string, unknown>
  }
  delete cur[keys[keys.length - 1]!]
}
