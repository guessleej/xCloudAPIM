import type { Redis } from 'ioredis'
import type { FastifyBaseLogger } from 'fastify'

// ─── Policy 定義（從 Policy Engine 取回）────────────────────

export type PolicyType =
  | 'jwt_auth' | 'api_key_auth' | 'rate_limit' | 'cors'
  | 'request_transform' | 'response_transform' | 'ip_whitelist'
  | 'cache' | 'circuit_breaker' | 'logging'

export type PolicyPhase =
  | 'pre_request' | 'post_request' | 'pre_response' | 'post_response'

export const PHASE_ORDER: Record<PolicyPhase, number> = {
  pre_request:   0,
  post_request:  1,
  pre_response:  2,
  post_response: 3,
}

export interface PolicyDef {
  id:        string
  type:      PolicyType
  phase:     PolicyPhase
  order:     number
  enabled:   boolean
  config:    Record<string, string>
  condition?: string
}

export interface PolicyChain {
  chainId:  string
  apiId:    string
  version:  number
  etag:     string
  policies: PolicyDef[]
}

// ─── Execution Context ────────────────────────────────────────

export interface ExecContext {
  // 識別
  traceId:        string
  apiId:          string
  clientId:       string
  userId:         string
  plan:           string
  subscriptionId: string
  orgId:          string
  scopes:         string[]

  // 執行階段（plugin 可讀）
  phase: PolicyPhase | ''

  // 請求（可修改）
  method:          string
  path:            string
  host:            string
  remoteIp:        string
  clientIp:        string   // 真實 client IP（X-Forwarded-For 解析後）
  requestHeaders:  Record<string, string>
  requestBody:     Buffer | null
  queryParams:     Record<string, string>

  // 回應（post_request 後才有值）
  statusCode:      number
  responseHeaders: Record<string, string>
  responseBody:    Buffer | null

  // Cache
  cacheHit:        boolean

  // 中止旗標
  aborted:         boolean
  abortCode:       number
  abortMessage:    string
  abortHeaders:    Record<string, string>

  // JWT Claims / auth claims
  claims:          Record<string, unknown>

  startedAt:       number   // Date.now()

  // 中止快捷方法
  abort(code: number, message: string, headers?: Record<string, string>): void
}

export function createExecContext(
  apiId: string,
  traceId: string,
  method: string,
  path: string,
  host: string,
  remoteIp: string,
  requestHeaders: Record<string, string>,
  queryParams: Record<string, string>,
  body: Buffer | null,
): ExecContext {
  const ctx: ExecContext = {
    traceId, apiId,
    clientId: '', userId: '', plan: '', subscriptionId: '', orgId: '', scopes: [],
    phase: '',
    method, path, host, remoteIp,
    clientIp: parseClientIp(requestHeaders, remoteIp),
    requestHeaders, requestBody: body, queryParams,
    statusCode: 0, responseHeaders: {}, responseBody: null,
    cacheHit: false,
    aborted: false, abortCode: 0, abortMessage: '', abortHeaders: {},
    claims: {},
    startedAt: Date.now(),
    abort(code, message, headers) {
      this.aborted      = true
      this.abortCode    = code
      this.abortMessage = message
      if (headers) this.abortHeaders = headers
    },
  }
  return ctx
}

function parseClientIp(headers: Record<string, string>, remoteIp: string): string {
  const xff = headers['x-forwarded-for']
  if (xff) return xff.split(',')[0]!.trim()
  return headers['x-real-ip'] ?? remoteIp
}

/** 向後相容：舊 plugin 使用的 standalone abort helper */
export function abort(ctx: ExecContext, code: number, message: string, headers?: Record<string, string>): void {
  ctx.abort(code, message, headers)
}

// ─── Plugin Interface ─────────────────────────────────────────

export interface PluginDeps {
  redis:  Redis
  log:    FastifyBaseLogger
  config: Record<string, string>
}

export type PluginExecutor = (
  ctx:  ExecContext,
  deps: PluginDeps,
) => Promise<void>
