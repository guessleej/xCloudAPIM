/**
 * Query String 轉換
 *
 * config:
 *   add_query    = "key=value;key2=${ctx.clientId}"   (分號分隔)
 *   remove_query = "debug,internal_flag"              (逗號分隔)
 *   rename_query = "old_name:new_name;foo:bar"        (分號分隔，old:new)
 */
import type { ExecContext } from '../../types.js'
import { resolveTemplate }  from './variables.js'

export function transformQueryParams(ctx: ExecContext, cfg: Record<string, string>): void {
  const addRaw    = cfg['add_query']
  const removeRaw = cfg['remove_query']
  const renameRaw = cfg['rename_query']

  if (removeRaw) {
    for (const key of removeRaw.split(',').map((s) => s.trim()).filter(Boolean)) {
      delete ctx.queryParams[key]
    }
  }

  if (renameRaw) {
    for (const pair of renameRaw.split(';').map((s) => s.trim()).filter(Boolean)) {
      const colonIdx = pair.indexOf(':')
      if (colonIdx < 0) continue
      const oldKey = pair.slice(0, colonIdx).trim()
      const newKey = pair.slice(colonIdx + 1).trim()
      if (oldKey && newKey && ctx.queryParams[oldKey] !== undefined) {
        ctx.queryParams[newKey] = ctx.queryParams[oldKey]!
        delete ctx.queryParams[oldKey]
      }
    }
  }

  if (addRaw) {
    for (const kv of addRaw.split(';').map((s) => s.trim()).filter(Boolean)) {
      const eqIdx = kv.indexOf('=')
      if (eqIdx < 0) continue
      const key = kv.slice(0, eqIdx).trim()
      const val = resolveTemplate(kv.slice(eqIdx + 1), ctx)
      if (key) ctx.queryParams[key] = val
    }
  }
}
