// ═══════════════════════════════════════════════════════════════
//  xCloudAPIM — 共用 TypeScript 型別定義
// ═══════════════════════════════════════════════════════════════

// ─── API ─────────────────────────────────────────────────────
export interface Api {
  id: string
  name: string
  description?: string
  version: string
  basePath: string
  upstreamUrl: string
  status: ApiStatus
  spec?: string       // OpenAPI 3.x YAML/JSON
  createdAt: string
  updatedAt: string
}

export type ApiStatus = 'draft' | 'published' | 'deprecated' | 'archived'

// ─── Policy ──────────────────────────────────────────────────
export interface PolicyChain {
  id: string
  apiId: string
  name: string
  policies: PolicyNode[]
  version: number
  publishedAt?: string
  createdAt: string
  updatedAt: string
}

export interface PolicyNode {
  id: string
  type: PolicyType
  phase: PolicyPhase
  order: number
  enabled: boolean
  config: PolicyConfig
  position?: { x: number; y: number }  // React Flow 座標
}

export type PolicyType =
  | 'jwt_auth'
  | 'api_key_auth'
  | 'rate_limit'
  | 'cors'
  | 'request_transform'
  | 'response_transform'
  | 'ip_whitelist'
  | 'cache'
  | 'encrypt'
  | 'circuit_breaker'
  | 'logging'

export type PolicyPhase =
  | 'pre_request'
  | 'post_request'
  | 'pre_response'
  | 'post_response'

export type PolicyConfig =
  | JwtAuthConfig
  | RateLimitConfig
  | CorsConfig
  | TransformConfig
  | IpWhitelistConfig
  | CacheConfig
  | EncryptConfig
  | CircuitBreakerConfig
  | LoggingConfig
  | Record<string, unknown>

export interface JwtAuthConfig {
  algorithm: 'RS256' | 'HS256' | 'ES256'
  jwksUrl?: string
  issuer?: string
  audience?: string
  requiredScopes?: string[]
  cacheSeconds?: number
}

export interface RateLimitConfig {
  strategy: 'fixed_window' | 'sliding_window' | 'token_bucket'
  rpm?: number
  rph?: number
  rpd?: number
  keyBy: 'client_id' | 'ip' | 'user_id'
  burstMultiplier?: number
}

export interface CorsConfig {
  allowedOrigins: string[]
  allowedMethods: string[]
  allowedHeaders: string[]
  exposedHeaders?: string[]
  allowCredentials?: boolean
  maxAge?: number
}

export interface TransformConfig {
  requestHeaders?: HeaderTransform[]
  responseHeaders?: HeaderTransform[]
  requestBody?: BodyTransform[]
  responseBody?: BodyTransform[]
  urlRewrite?: UrlRewrite
}

export interface HeaderTransform {
  action: 'add' | 'set' | 'remove' | 'rename'
  name: string
  value?: string
  newName?: string
}

export interface BodyTransform {
  path: string      // JSONPath
  action: 'set' | 'remove' | 'rename'
  value?: unknown
  newPath?: string
}

export interface UrlRewrite {
  from: string      // regex pattern
  to: string        // replacement
}

export interface IpWhitelistConfig {
  mode: 'whitelist' | 'blacklist'
  ips: string[]     // 支援 CIDR（e.g., 192.168.1.0/24）
}

export interface CacheConfig {
  ttlSeconds: number
  keyBy: string[]   // ['method', 'path', 'query.*']
  varyHeaders?: string[]
  invalidateOn?: string[]
}

export interface EncryptConfig {
  algorithm: 'AES-256-GCM' | 'RSA-OAEP'
  fields: string[]  // JSONPath 欄位清單
  keyRef: string    // Vault key reference
}

export interface CircuitBreakerConfig {
  threshold: number       // 失敗率 0-100
  windowSeconds: number
  halfOpenRequests: number
  timeoutMs: number
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error'
  includeHeaders?: string[]
  includeBody?: boolean
  maskFields?: string[]   // 敏感欄位遮罩
}

// ─── OAuth2 / Auth ────────────────────────────────────────────
export interface OAuthClient {
  id: string
  name: string
  clientId: string
  grantTypes: GrantType[]
  redirectUris: string[]
  scopes: string[]
  plan: PlanType
  active: boolean
  createdAt: string
}

export type GrantType =
  | 'authorization_code'
  | 'client_credentials'
  | 'refresh_token'
  | 'implicit'

export interface TokenClaims {
  sub: string
  clientId: string
  scopes: string[]
  plan: PlanType
  exp: number
  iat: number
  iss: string
  aud: string
}

// ─── Subscription / Plan ─────────────────────────────────────
export type PlanType = 'free' | 'basic' | 'pro' | 'enterprise'

export interface Plan {
  id: string
  name: PlanType
  rpmLimit: number
  dailyLimit: number
  monthlyLimit?: number
  features: string[]
  priceCents?: number
}

export interface Subscription {
  id: string
  clientId: string
  apiId: string
  planId: string
  status: SubscriptionStatus
  apiKey?: string
  startDate: string
  endDate?: string
}

export type SubscriptionStatus = 'active' | 'suspended' | 'expired' | 'pending'

// ─── Analytics ───────────────────────────────────────────────
export interface ApiStats {
  apiId: string
  period: string
  totalRequests: number
  successCount: number
  errorCount: number
  p50LatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
  topClients: { clientId: string; count: number }[]
  topPaths: { path: string; count: number }[]
  statusCodeBreakdown: Record<string, number>
}

// ─── Audit Log ────────────────────────────────────────────────
export interface AuditLog {
  id: string
  traceId: string
  clientId: string
  apiId: string
  method: string
  path: string
  statusCode: number
  latencyMs: number
  requestSize?: number
  responseSize?: number
  ip: string
  userAgent?: string
  timestamp: string
  errorMessage?: string
}

// ─── Gateway Config ───────────────────────────────────────────
export interface GatewayRoute {
  id: string
  apiId: string
  host?: string
  pathPrefix: string
  methods?: string[]
  upstreamUrl: string
  stripPrefix?: string
  chainId: string
  active: boolean
}

// ─── Pagination ───────────────────────────────────────────────
export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface PaginationParams {
  page?: number
  pageSize?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

// ─── API Response Wrapper ─────────────────────────────────────
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: unknown
  }
  meta?: {
    requestId: string
    timestamp: string
  }
}
