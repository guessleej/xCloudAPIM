export type PolicyPhase =
  | 'PRE_REQUEST'
  | 'POST_REQUEST'
  | 'PRE_RESPONSE'
  | 'POST_RESPONSE'

export type PolicyType =
  | 'auth'
  | 'rate_limit'
  | 'cors'
  | 'ip_whitelist'
  | 'transform'
  | 'cache'
  | 'circuit_breaker'

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
  chainId:   string
  apiId:     string
  version:   number
  etag:      string
  updatedAt: string | null
  policies:  PolicyDef[]
}

export interface APIInfo {
  id:          string
  name:        string
  version:     string
  basePath:    string
  upstreamUrl: string
  description: string | null
  status:      string
  orgId:       string
  tags:        string[]
  policyChain: PolicyChain | null
}

// ─── Plugin 定義（靜態元資料）─────────────────────────────────

export type PluginCategory = 'security' | 'traffic' | 'transform' | 'reliability'

export const PLUGIN_CATEGORY_LABELS: Record<PluginCategory, string> = {
  security:    '安全',
  traffic:     '流量',
  transform:   '轉換',
  reliability: '穩定性',
}

export const PLUGIN_CATEGORY_COLORS: Record<PluginCategory, string> = {
  security:    'text-violet-600 bg-violet-50 border-violet-200',
  traffic:     'text-amber-600  bg-amber-50  border-amber-200',
  transform:   'text-teal-600   bg-teal-50   border-teal-200',
  reliability: 'text-orange-600 bg-orange-50 border-orange-200',
}

export interface PolicyPluginMeta {
  type:             PolicyType
  label:            string
  description:      string
  docs:             string          // 一句話說明功能與場景
  icon:             string          // emoji fallback（向後相容）
  lucideIcon:       string          // lucide icon name，由 PluginCard 對應
  color:            string          // Tailwind bg class（icon 背景）
  textColor:        string          // Tailwind text class
  borderColor:      string          // Tailwind border class（選中/hover）
  category:         PluginCategory
  compatiblePhases: PolicyPhase[]
  defaultPhase:     PolicyPhase
  defaultConfig:    Record<string, string>
}

export const PLUGIN_REGISTRY: PolicyPluginMeta[] = [
  {
    type: 'auth', label: 'Auth', category: 'security',
    description: 'JWT / API Key / HMAC 驗證',
    docs: '在請求進入 upstream 前驗證呼叫方身份，支援多方法串聯',
    icon: '🔐', lucideIcon: 'ShieldCheck',
    color: 'bg-violet-100', textColor: 'text-violet-700', borderColor: 'border-violet-300',
    compatiblePhases: ['PRE_REQUEST'],
    defaultPhase: 'PRE_REQUEST',
    defaultConfig: { methods: 'jwt', 'jwt.algorithm': 'RS256' },
  },
  {
    type: 'rate_limit', label: 'Rate Limit', category: 'traffic',
    description: 'RPM / RPH / RPD 速率限制',
    docs: '依 Client / IP / User 設定每分鐘、每小時、每日請求配額',
    icon: '⏱', lucideIcon: 'Gauge',
    color: 'bg-amber-100', textColor: 'text-amber-700', borderColor: 'border-amber-300',
    compatiblePhases: ['PRE_REQUEST'],
    defaultPhase: 'PRE_REQUEST',
    defaultConfig: { strategy: 'sliding_window', rpm: '1000', key_by: 'client_id' },
  },
  {
    type: 'cors', label: 'CORS', category: 'security',
    description: 'Cross-Origin Resource Sharing',
    docs: '處理瀏覽器跨域預飛請求，設定允許的來源、方法與標頭',
    icon: '🌐', lucideIcon: 'Globe',
    color: 'bg-sky-100', textColor: 'text-sky-700', borderColor: 'border-sky-300',
    compatiblePhases: ['PRE_REQUEST'],
    defaultPhase: 'PRE_REQUEST',
    defaultConfig: { allowed_origins: '*', allowed_methods: 'GET,POST,PUT,DELETE,OPTIONS' },
  },
  {
    type: 'ip_whitelist', label: 'IP Filter', category: 'security',
    description: 'IP 白名單 / 黑名單過濾',
    docs: '依來源 IP 或 CIDR 段允許或拒絕存取，支援 X-Forwarded-For',
    icon: '🛡', lucideIcon: 'Shield',
    color: 'bg-red-100', textColor: 'text-red-700', borderColor: 'border-red-300',
    compatiblePhases: ['PRE_REQUEST'],
    defaultPhase: 'PRE_REQUEST',
    defaultConfig: { mode: 'whitelist', ips: '' },
  },
  {
    type: 'transform', label: 'Transform', category: 'transform',
    description: 'Header / Query / Body 轉換',
    docs: '在請求或回應中新增、修改、刪除 Header、Query 參數與 JSON Body',
    icon: '🔀', lucideIcon: 'ArrowLeftRight',
    color: 'bg-teal-100', textColor: 'text-teal-700', borderColor: 'border-teal-300',
    compatiblePhases: ['PRE_REQUEST', 'POST_REQUEST', 'PRE_RESPONSE', 'POST_RESPONSE'],
    defaultPhase: 'PRE_REQUEST',
    defaultConfig: { inject_request_id: 'true', inject_gateway_id: 'true' },
  },
  {
    type: 'cache', label: 'Cache', category: 'reliability',
    description: 'Redis Response Cache',
    docs: '依 Path / Method / Client 快取 upstream 回應，TTL 可設定',
    icon: '⚡', lucideIcon: 'Layers',
    color: 'bg-green-100', textColor: 'text-green-700', borderColor: 'border-green-300',
    compatiblePhases: ['PRE_REQUEST', 'POST_RESPONSE'],
    defaultPhase: 'PRE_REQUEST',
    defaultConfig: { ttl: '60', key_by: 'path' },
  },
  {
    type: 'circuit_breaker', label: 'Circuit Breaker', category: 'reliability',
    description: '熔斷器 / 服務保護',
    docs: '當 upstream 錯誤率或失敗次數超過閾值時自動熔斷，避免雪崩',
    icon: '⚠', lucideIcon: 'ToggleLeft',
    color: 'bg-orange-100', textColor: 'text-orange-700', borderColor: 'border-orange-300',
    compatiblePhases: ['PRE_REQUEST', 'POST_REQUEST'],
    defaultPhase: 'PRE_REQUEST',
    defaultConfig: { threshold: '5', timeout: '30', error_threshold: '50' },
  },
]

export const PHASE_ORDER: PolicyPhase[] = [
  'PRE_REQUEST', 'POST_REQUEST', 'PRE_RESPONSE', 'POST_RESPONSE',
]

export const PHASE_LABELS: Record<PolicyPhase, string> = {
  PRE_REQUEST:   'Pre-Request',
  POST_REQUEST:  'Post-Request',
  PRE_RESPONSE:  'Pre-Response',
  POST_RESPONSE: 'Post-Response',
}

export const PHASE_COLORS: Record<PolicyPhase, string> = {
  PRE_REQUEST:   'border-blue-300 bg-blue-50',
  POST_REQUEST:  'border-green-300 bg-green-50',
  PRE_RESPONSE:  'border-purple-300 bg-purple-50',
  POST_RESPONSE: 'border-orange-300 bg-orange-50',
}
