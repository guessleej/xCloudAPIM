/**
 * Auth Plugin — 多方法認證入口
 *
 * config keys:
 *   methods         = "jwt"                          (逗號分隔，依序嘗試)
 *                     "jwt,api_key" | "api_key,basic" | "hmac" | "introspect" 等
 *   allow_anonymous = "false"                        (所有方法都失敗時是否放行)
 *   realm           = "xCloudAPIM"                   (WWW-Authenticate realm)
 *
 * 每個方法的 config key 使用 <method>.<key> 前綴，例如：
 *   jwt.algorithm = "RS256"
 *   jwt.jwks_url  = "https://..."
 *   api_key.key_location = "header,query"
 *   hmac.secret   = "my-webhook-secret"
 */
import type { ExecContext, PluginDeps } from '../../types.js'
import { jwtAuth }         from './jwt.js'
import { apiKeyAuth }      from './api-key.js'
import { basicAuth }       from './basic.js'
import { tokenIntrospect } from './introspect.js'
import { hmacAuth }        from './hmac.js'

type AuthFn = (
  ctx:  ExecContext,
  deps: PluginDeps,
) => Promise<{ ok: boolean; reason?: string }>

const AUTH_METHODS: Record<string, AuthFn> = {
  jwt:        jwtAuth,
  api_key:    apiKeyAuth,
  basic:      basicAuth,
  introspect: tokenIntrospect,
  hmac:       hmacAuth,
}

const WWW_AUTHENTICATE_SCHEMES: Record<string, string> = {
  jwt:        'Bearer',
  api_key:    'ApiKey',
  basic:      'Basic',
  introspect: 'Bearer',
  hmac:       'HMAC',
}

export async function authPlugin(
  ctx:  ExecContext,
  deps: PluginDeps,
): Promise<void> {
  const cfg     = deps.config
  const methods = (cfg['methods'] ?? 'jwt').split(',').map((s) => s.trim()).filter(Boolean)
  const realm   = cfg['realm'] ?? 'xCloudAPIM'

  const failures: Array<{ method: string; reason: string }> = []

  for (const method of methods) {
    const fn = AUTH_METHODS[method]
    if (!fn) {
      deps.log.warn({ method }, 'unknown auth method in config, skipping')
      continue
    }

    // 將 <method>.<key> 前綴的 config 提取為子集，並允許無前綴 fallback
    const subCfg = buildSubConfig(cfg, method)
    const subDeps: PluginDeps = { ...deps, config: subCfg }

    try {
      const result = await fn(ctx, subDeps)
      if (result.ok) return   // 認證成功，直接返回

      failures.push({ method, reason: result.reason ?? 'auth failed' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error'
      deps.log.warn({ method, err }, 'auth method threw unexpectedly')
      failures.push({ method, reason: msg })
    }
  }

  // 所有方法都失敗
  if (cfg['allow_anonymous'] === 'true') return

  // 建立 WWW-Authenticate header（列出所有方法）
  const schemes = methods
    .filter((m) => AUTH_METHODS[m])
    .map((m) => {
      const scheme = WWW_AUTHENTICATE_SCHEMES[m] ?? 'Bearer'
      return `${scheme} realm="${realm}"`
    })
    .join(', ')

  const firstReason = failures[0]?.reason ?? 'authentication required'

  ctx.abort(401, `Unauthorized: ${firstReason}`, {
    'www-authenticate': schemes,
    'x-auth-failure':   failures.map((f) => `${f.method}:${f.reason}`).join('; '),
  })
}

function buildSubConfig(
  cfg:    Record<string, string>,
  method: string,
): Record<string, string> {
  const prefix = `${method}.`
  const sub: Record<string, string> = {}

  for (const [k, v] of Object.entries(cfg)) {
    if (k.startsWith(prefix)) {
      sub[k.slice(prefix.length)] = v
    } else if (!k.includes('.')) {
      // 無前綴的 key 作為 fallback（避免重複宣告）
      if (!(k in sub)) sub[k] = v
    }
  }

  return sub
}
