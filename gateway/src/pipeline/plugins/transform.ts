import type { ExecContext, PluginDeps } from '../types.js'

// ─── Request Transform ────────────────────────────────────────

export async function requestTransform(ctx: ExecContext, deps: PluginDeps): Promise<void> {
  const cfg = deps.config

  // add_headers（僅在不存在時設定）
  if (cfg['add_headers']) {
    for (const [k, v] of parseKVPairs(cfg['add_headers'])) {
      if (!ctx.requestHeaders[k.toLowerCase()]) {
        ctx.requestHeaders[k.toLowerCase()] = v
      }
    }
  }

  // set_headers（強制覆寫）
  if (cfg['set_headers']) {
    for (const [k, v] of parseKVPairs(cfg['set_headers'])) {
      ctx.requestHeaders[k.toLowerCase()] = v
    }
  }

  // remove_headers
  if (cfg['remove_headers']) {
    for (const key of parseCSV(cfg['remove_headers'])) {
      delete ctx.requestHeaders[key.toLowerCase()]
      delete ctx.requestHeaders[key]
    }
  }

  // url_rewrite（from:to 以 : 分隔）
  if (cfg['url_rewrite']) {
    const colonIdx = cfg['url_rewrite'].indexOf(':')
    if (colonIdx > 0) {
      const from = cfg['url_rewrite'].slice(0, colonIdx)
      const to   = cfg['url_rewrite'].slice(colonIdx + 1)
      try {
        ctx.path = ctx.path.replace(new RegExp(from), to)
      } catch { /* 無效 regex，跳過 */ }
    }
  }

  // inject_trace
  if (cfg['inject_trace'] === 'true' && ctx.traceId) {
    ctx.requestHeaders['x-trace-id']   = ctx.traceId
    ctx.requestHeaders['x-request-id'] = ctx.traceId
  }
}

// ─── Response Transform ───────────────────────────────────────

export async function responseTransform(ctx: ExecContext, deps: PluginDeps): Promise<void> {
  const cfg = deps.config

  if (cfg['add_headers']) {
    for (const [k, v] of parseKVPairs(cfg['add_headers'])) {
      ctx.responseHeaders[k.toLowerCase()] = v
    }
  }
  if (cfg['remove_headers']) {
    for (const key of parseCSV(cfg['remove_headers'])) {
      delete ctx.responseHeaders[key.toLowerCase()]
    }
  }
  // 安全預設：移除洩漏伺服器資訊的 headers
  delete ctx.responseHeaders['server']
  delete ctx.responseHeaders['x-powered-by']

  // mask_fields
  if (cfg['mask_fields'] && ctx.responseBody) {
    try {
      const obj = JSON.parse(ctx.responseBody.toString())
      for (const field of parseCSV(cfg['mask_fields'])) {
        maskField(obj, field.split('.'))
      }
      ctx.responseBody = Buffer.from(JSON.stringify(obj))
    } catch { /* 非 JSON body，跳過 */ }
  }
}

// ─── helpers ─────────────────────────────────────────────────

function parseKVPairs(s: string): [string, string][] {
  return parseCSV(s).flatMap((entry) => {
    const idx = entry.indexOf(':')
    if (idx < 0) return []
    return [[entry.slice(0, idx).trim(), entry.slice(idx + 1).trim()]] as [string, string][]
  })
}

function parseCSV(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean)
}

function maskField(obj: unknown, path: string[]): void {
  if (!path.length || typeof obj !== 'object' || obj === null) return
  const map = obj as Record<string, unknown>
  if (path.length === 1) {
    if (path[0]! in map) map[path[0]!] = '***'
    return
  }
  maskField(map[path[0]!], path.slice(1))
}
