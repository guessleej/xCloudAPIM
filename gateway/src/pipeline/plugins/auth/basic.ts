/**
 * Basic Auth — Base64(username:password) → Auth Service 驗證
 *
 * config keys:
 *   auth_endpoint = "http://auth-service:8081/internal/basic/verify"
 *   realm         = "xCloudAPIM"  (WWW-Authenticate header)
 *   fail_open     = "false"
 */
import { fetch } from 'undici'
import type { ExecContext, PluginDeps } from '../../types.js'
import { applyIdentity } from './claims.js'
import { config as appConfig } from '../../../config/index.js'

export async function basicAuth(
  ctx:  ExecContext,
  deps: PluginDeps,
): Promise<{ ok: boolean; reason?: string }> {
  const auth = ctx.requestHeaders['authorization'] ?? ''
  if (!auth.toLowerCase().startsWith('basic ')) {
    return { ok: false, reason: 'missing Basic credentials' }
  }

  let username: string
  let password: string
  try {
    const decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf-8')
    const colonIdx = decoded.indexOf(':')
    if (colonIdx < 0) return { ok: false, reason: 'invalid Basic credentials format' }
    username = decoded.slice(0, colonIdx)
    password = decoded.slice(colonIdx + 1)
  } catch {
    return { ok: false, reason: 'invalid Basic credentials encoding' }
  }

  if (!username || !password) return { ok: false, reason: 'missing username or password' }

  const endpoint = deps.config['auth_endpoint']
    ?? `${appConfig.AUTH_SERVICE_URL}/internal/basic/verify`

  try {
    const resp = await fetch(endpoint, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ username, password }),
      signal:  AbortSignal.timeout(3000),
    })

    if (resp.status === 401) return { ok: false, reason: 'invalid username or password' }
    if (resp.status === 403) return { ok: false, reason: 'account disabled' }
    if (!resp.ok) {
      if (deps.config['fail_open'] === 'true') return { ok: true }
      return { ok: false, reason: 'auth service unavailable' }
    }

    const body = await resp.json() as Record<string, unknown>
    applyIdentity(ctx, {
      clientId:       String(body['client_id'] ?? ''),
      userId:         String(body['user_id']   ?? username),
      plan:           String(body['plan']       ?? ''),
      subscriptionId: '',
      orgId:          String(body['org_id']     ?? ''),
      scopes:         [],
      claims:         (body['claims'] as Record<string, unknown>) ?? {},
    })
    return { ok: true }
  } catch (err) {
    deps.log.warn({ err }, 'basic auth verify error')
    if (deps.config['fail_open'] === 'true') return { ok: true }
    return { ok: false, reason: 'auth service unavailable' }
  }
}
