import type { ExecContext, PluginDeps } from '../types.js'
import { abort } from '../types.js'

export async function cors(ctx: ExecContext, deps: PluginDeps): Promise<void> {
  const origin = ctx.requestHeaders['origin'] ?? ctx.requestHeaders['Origin']
  if (!origin) return // 非 CORS 請求

  const allowedOrigins = parseCSV(deps.config['allowed_origins'] ?? '*')
  const allowedMethods = parseCSV(deps.config['allowed_methods'] ?? 'GET,POST,PUT,DELETE,OPTIONS')
  const allowedHeaders = parseCSV(deps.config['allowed_headers'] ?? 'Content-Type,Authorization')
  const exposedHeaders = deps.config['exposed_headers']
  const allowCreds     = deps.config['allow_credentials'] === 'true'
  const maxAge         = deps.config['max_age'] ?? '3600'

  if (!originMatches(origin, allowedOrigins)) {
    abort(ctx, 403, 'CORS: origin not allowed')
    return
  }

  ctx.responseHeaders['access-control-allow-origin'] = origin
  ctx.responseHeaders['vary'] = 'Origin'
  if (allowCreds) ctx.responseHeaders['access-control-allow-credentials'] = 'true'
  if (exposedHeaders) ctx.responseHeaders['access-control-expose-headers'] = exposedHeaders

  // Preflight
  if (ctx.method.toUpperCase() === 'OPTIONS') {
    ctx.responseHeaders['access-control-allow-methods'] = allowedMethods.join(', ')
    ctx.responseHeaders['access-control-allow-headers'] = allowedHeaders.join(', ')
    ctx.responseHeaders['access-control-max-age']       = maxAge
    abort(ctx, 204, '')
  }
}

function originMatches(origin: string, allowed: string[]): boolean {
  for (const a of allowed) {
    if (a === '*' || a.toLowerCase() === origin.toLowerCase()) return true
    if (a.startsWith('*.')) {
      const suffix = a.slice(1) // .example.com
      if (origin.toLowerCase().endsWith(suffix.toLowerCase())) return true
    }
  }
  return false
}

function parseCSV(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean)
}
