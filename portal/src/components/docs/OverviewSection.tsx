import { Globe, Lock, Zap, Clock } from 'lucide-react'
import CodeBlock from './CodeBlock'

interface Plan {
  id: string; name: string; isFree: boolean
  rateLimit: { rpm: number; rph: number; rpd: number } | null
  quotaLimit: { daily: number; monthly: number } | null
}

interface Props {
  api: {
    name:        string
    version:     string
    basePath:    string
    description: string | null
    upstreamUrl: string
    tags:        string[]
    policyChain: {
      policies: Array<{ type: string; enabled: boolean; config: Record<string, string> }>
    } | null
    plans: Plan[]
  }
  gatewayUrl: string
}

export default function OverviewSection({ api, gatewayUrl }: Props) {
  const authPolicies = (api.policyChain?.policies ?? [])
    .filter((p) => p.type === 'auth' && p.enabled)

  const authMethods = authPolicies.length > 0
    ? (authPolicies[0].config['methods'] ?? 'jwt').split(',').map((s) => s.trim())
    : []

  const rateLimitPolicy = (api.policyChain?.policies ?? [])
    .find((p) => p.type === 'rate_limit' && p.enabled)

  const baseUrl = `${gatewayUrl}${api.basePath}`

  return (
    <div className="space-y-8">
      {/* Description */}
      {api.description && (
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-3">說明</h2>
          <p className="text-gray-600 leading-relaxed">{api.description}</p>
        </section>
      )}

      {/* Base URL */}
      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
          <Globe size={18} className="text-brand-600" /> Base URL
        </h2>
        <CodeBlock
          language="bash"
          code={baseUrl}
          className="text-sm"
        />
        <p className="text-sm text-gray-500 mt-2">
          所有 API 請求都應使用此作為基底 URL。
        </p>
      </section>

      {/* Authentication */}
      {authMethods.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
            <Lock size={18} className="text-brand-600" /> 認證方式
          </h2>
          <div className="space-y-4">
            {authMethods.map((method) => (
              <AuthMethodCard key={method} method={method} gatewayUrl={gatewayUrl} />
            ))}
          </div>
        </section>
      )}

      {/* Rate limits */}
      {rateLimitPolicy && (
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
            <Clock size={18} className="text-brand-600" /> 速率限制
          </h2>
          <RateLimitTable policy={rateLimitPolicy} plans={api.plans} />
        </section>
      )}

      {/* Quick facts */}
      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
          <Zap size={18} className="text-brand-600" /> 基本資訊
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: '版本',  value: `v${api.version}` },
            { label: 'Base Path', value: api.basePath },
            { label: '標籤',  value: api.tags?.join(', ') || '—' },
          ].map(({ label, value }) => (
            <div key={label} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <p className="text-xs text-gray-500 mb-0.5">{label}</p>
              <p className="text-sm font-mono font-medium text-gray-800 break-all">{value}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

// ─── Auth method card ─────────────────────────────────────────

function AuthMethodCard({ method, gatewayUrl }: { method: string; gatewayUrl: string }) {
  if (method === 'jwt' || method === 'oauth2') {
    return (
      <div className="border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-100 text-violet-700">
            Bearer Token (JWT)
          </span>
        </div>
        <p className="text-sm text-gray-600">
          在 HTTP 標頭中傳入您的 JWT Access Token：
        </p>
        <CodeBlock language="bash" code={`Authorization: Bearer YOUR_ACCESS_TOKEN`} />
        <p className="text-sm text-gray-500">
          Token 可透過 OAuth 2.0 Authorization Code 或 Client Credentials Flow 取得。
        </p>
      </div>
    )
  }

  if (method === 'api_key') {
    return (
      <div className="border border-gray-200 rounded-xl p-4 space-y-3">
        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
          API Key
        </span>
        <p className="text-sm text-gray-600">
          在 HTTP 標頭或 Query Parameter 中帶入您的 API Key：
        </p>
        <CodeBlock language="bash" code={`# Header（推薦）
X-API-Key: YOUR_API_KEY

# 或 Query Parameter
GET ${gatewayUrl}/endpoint?api_key=YOUR_API_KEY`} />
      </div>
    )
  }

  return (
    <div className="border border-gray-200 rounded-xl p-4">
      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
        {method}
      </span>
    </div>
  )
}

// ─── Rate limit table ─────────────────────────────────────────

function RateLimitTable({
  policy,
  plans,
}: {
  policy: { config: Record<string, string> }
  plans:  Plan[]
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        策略：<code className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
          {policy.config['strategy'] ?? 'sliding_window'}
        </code>
        {' · '}
        識別方式：<code className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
          {policy.config['key_by'] ?? 'client_id'}
        </code>
      </p>

      {plans.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['方案', 'RPM', 'RPH', 'RPD', '月配額'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {plans.map((plan) => (
                <tr key={plan.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{plan.name}</td>
                  <td className="px-4 py-3 font-mono text-gray-600">{plan.rateLimit?.rpm?.toLocaleString() ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-gray-600">{plan.rateLimit?.rph?.toLocaleString() ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-gray-600">{plan.rateLimit?.rpd?.toLocaleString() ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-gray-600">{plan.quotaLimit?.monthly?.toLocaleString() ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
        超過速率限制時，API Gateway 會回傳 <code className="font-mono text-xs bg-blue-100 px-1 py-0.5 rounded">429 Too Many Requests</code>，
        並在 <code className="font-mono text-xs">X-RateLimit-Reset</code> 標頭中說明重置時間。
      </div>
    </div>
  )
}
