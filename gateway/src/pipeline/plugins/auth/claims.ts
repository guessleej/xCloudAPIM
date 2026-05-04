/**
 * Claims 工具：注入驗證結果至 ExecContext 與 upstream headers
 */
import type { ExecContext } from '../../types.js'

export interface AuthIdentity {
  clientId:       string
  userId:         string
  plan:           string
  subscriptionId: string
  orgId:          string
  scopes:         string[]
  claims:         Record<string, unknown>
}

/** 將 AuthIdentity 回寫至 ExecContext 並注入標準 upstream headers */
export function applyIdentity(ctx: ExecContext, id: AuthIdentity): void {
  if (id.clientId)       ctx.clientId       = id.clientId
  if (id.userId)         ctx.userId         = id.userId
  if (id.plan)           ctx.plan           = id.plan
  if (id.subscriptionId) ctx.subscriptionId = id.subscriptionId
  if (id.orgId)          ctx.orgId          = id.orgId
  if (id.scopes.length)  ctx.scopes         = id.scopes

  for (const [k, v] of Object.entries(id.claims)) {
    ctx.claims[k] = v
  }

  setIfTruthy(ctx.requestHeaders, 'x-client-id',       id.clientId)
  setIfTruthy(ctx.requestHeaders, 'x-user-id',         id.userId)
  setIfTruthy(ctx.requestHeaders, 'x-plan',             id.plan)
  setIfTruthy(ctx.requestHeaders, 'x-subscription-id', id.subscriptionId)
  setIfTruthy(ctx.requestHeaders, 'x-org-id',          id.orgId)

  if (id.scopes.length) {
    ctx.requestHeaders['x-scopes'] = id.scopes.join(' ')
  }
}

/**
 * 依 forward_claims 設定，將指定 claims 轉注為 X-Claim-<Name> headers。
 * 設定格式：`forward_claims = "sub,email,plan"` 或 `"*"` 轉全部
 */
export function forwardClaims(
  ctx:     ExecContext,
  claims:  Record<string, unknown>,
  cfgKeys: string,
): void {
  const keys = cfgKeys === '*'
    ? Object.keys(claims)
    : cfgKeys.split(',').map((s) => s.trim()).filter(Boolean)

  for (const k of keys) {
    const v = claims[k]
    if (v !== undefined && v !== null) {
      ctx.requestHeaders[`x-claim-${k.toLowerCase()}`] = String(v)
    }
  }
}

export function extractScopes(payload: Record<string, unknown>): string[] {
  const raw = payload['scopes'] ?? payload['scope']
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === 'string')
  if (typeof raw === 'string') return raw.split(/\s+/).filter(Boolean)
  return []
}

function setIfTruthy(map: Record<string, string>, key: string, val: string): void {
  if (val) map[key] = val
}
