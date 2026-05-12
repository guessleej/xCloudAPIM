import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { getAuthClient, getRscClient } from '@/lib/apollo/client'
import { GET_API_FOR_DOCS } from '@/lib/graphql/queries'
import { getSession } from '@/lib/auth'
import DocTabNav from '@/components/docs/DocTabNav'
import OverviewSection from '@/components/docs/OverviewSection'
import SpecViewer from '@/components/api/SpecViewer'
import MultiLangExamples from '@/components/docs/MultiLangExamples'
import ErrorsSection from '@/components/docs/ErrorsSection'
import DocsApiHeader from '@/components/docs/DocsApiHeader'

export const dynamic = 'force-dynamic'

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'https://api.example.com'

type Tab = 'overview' | 'reference' | 'examples' | 'errors'

interface Props {
  params:       { id: string }
  searchParams: { tab?: string }
}

async function getAPI(id: string, token?: string) {
  try {
    const client = token ? getAuthClient(token) : getRscClient()
    const { data } = await client.query({
      query: GET_API_FOR_DOCS,
      variables: { id },
    })
    return data?.api ?? null
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const api = await getAPI(params.id)
  if (!api) return { title: 'API 文件' }
  return {
    title:       `${api.name} 文件`,
    description: api.description ?? `${api.name} API 完整參考文件`,
  }
}

export default async function APIDocsPage({ params, searchParams }: Props) {
  const session = await getSession()
  const api = await getAPI(params.id, session?.token)
  if (!api) notFound()

  const tab = ((searchParams.tab ?? 'overview') as Tab)

  const authMethods: string[] = (() => {
    const authPolicy = (api.policyChain?.policies ?? [])
      .find((p: { type: string; enabled: boolean }) => p.type === 'auth' && p.enabled)
    if (!authPolicy) return []
    return (authPolicy.config?.['methods'] ?? 'jwt')
      .split(',').map((s: string) => s.trim()).filter(Boolean)
  })()

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      {/* API header */}
      <DocsApiHeader api={api} />

      {/* Tab navigation */}
      <div className="mt-6 mb-0 bg-white rounded-t-2xl border-x border-t border-gray-200 shadow-sm">
        <Suspense>
          <DocTabNav apiId={params.id} />
        </Suspense>
      </div>

      {/* Tab content */}
      <div className="bg-white rounded-b-2xl border-x border-b border-gray-200 shadow-sm p-6 lg:p-8">
        {tab === 'overview' && (
          <OverviewSection
            api={api}
            gatewayUrl={GATEWAY_URL}
          />
        )}

        {tab === 'reference' && (
          <div className="min-h-[400px]">
            <div className="mb-4">
              <h2 className="text-lg font-bold text-gray-900">API Reference</h2>
              <p className="text-sm text-gray-500 mt-1">
                互動式 API Explorer — 直接在瀏覽器中試用每個端點
              </p>
            </div>
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <SpecViewer apiId={api.id} basePath={api.basePath} />
            </div>
          </div>
        )}

        {tab === 'examples' && (
          <div className="space-y-8">
            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-1">程式碼範例</h2>
              <p className="text-sm text-gray-500">
                快速複製並修改以下範例，開始整合 {api.name}
              </p>
            </div>

            {/* Quick start */}
            <section>
              <h3 className="font-semibold text-gray-800 mb-3">快速開始</h3>
              <MultiLangExamples
                apiName={api.name}
                baseUrl={GATEWAY_URL}
                basePath={api.basePath}
                authMethods={authMethods}
              />
            </section>

            {/* Auth section with full examples */}
            {authMethods.includes('api_key') && (
              <section>
                <h3 className="font-semibold text-gray-800 mb-3">使用 API Key 驗證</h3>
                <ApiKeyExampleBlock basePath={api.basePath} gatewayUrl={GATEWAY_URL} />
              </section>
            )}

            {(authMethods.includes('jwt') || authMethods.includes('oauth2')) && (
              <section>
                <h3 className="font-semibold text-gray-800 mb-3">使用 JWT / Bearer Token 驗證</h3>
                <JwtExampleBlock basePath={api.basePath} gatewayUrl={GATEWAY_URL} />
              </section>
            )}

            {/* Error handling example */}
            <section>
              <h3 className="font-semibold text-gray-800 mb-3">錯誤處理範例</h3>
              <ErrorHandlingExample />
            </section>
          </div>
        )}

        {tab === 'errors' && <ErrorsSection />}
      </div>
    </div>
  )
}

// ─── Inline example blocks ────────────────────────────────────

import CodeBlock from '@/components/docs/CodeBlock'

function ApiKeyExampleBlock({ basePath, gatewayUrl }: { basePath: string; gatewayUrl: string }) {
  const url = `${gatewayUrl}${basePath}`
  return (
    <div className="space-y-3">
      <CodeBlock
        language="bash"
        title="取得 API Key 後，在 Header 中帶入"
        code={`# 從 Developer Portal → 我的訂閱 → API Keys 建立並複製金鑰
curl -X GET "${url}/endpoint" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -H "Accept: application/json"`}
      />
      <CodeBlock
        language="javascript"
        title="JavaScript 範例"
        code={`const API_KEY = process.env.API_KEY;

const response = await fetch('${url}/endpoint', {
  headers: {
    'X-API-Key': API_KEY,
    'Accept': 'application/json',
  },
});

if (!response.ok) {
  const error = await response.json();
  throw new Error(\`API Error \${response.status}: \${error.message}\`);
}

const data = await response.json();`}
      />
    </div>
  )
}

function JwtExampleBlock({ basePath, gatewayUrl }: { basePath: string; gatewayUrl: string }) {
  const url = `${gatewayUrl}${basePath}`
  return (
    <div className="space-y-3">
      <CodeBlock
        language="bash"
        title="在 Authorization Header 中帶入 Bearer Token"
        code={`# 先透過 OAuth 2.0 取得 Access Token
ACCESS_TOKEN=$(curl -s -X POST "https://auth.example.com/oauth/token" \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=client_credentials&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET" \\
  | jq -r '.access_token')

# 使用 Token 呼叫 API
curl -X GET "${url}/endpoint" \\
  -H "Authorization: Bearer $ACCESS_TOKEN" \\
  -H "Accept: application/json"`}
      />
      <CodeBlock
        language="python"
        title="Python 範例（含 token refresh 邏輯）"
        code={`import requests

class APIClient:
    def __init__(self, client_id: str, client_secret: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self._token = None

    def _get_token(self) -> str:
        if self._token:
            return self._token
        resp = requests.post(
            "https://auth.example.com/oauth/token",
            data={
                "grant_type": "client_credentials",
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            }
        )
        resp.raise_for_status()
        self._token = resp.json()["access_token"]
        return self._token

    def get(self, path: str) -> dict:
        resp = requests.get(
            f"${url}{path}",
            headers={"Authorization": f"Bearer {self._get_token()}"}
        )
        resp.raise_for_status()
        return resp.json()

# 使用
client = APIClient("YOUR_CLIENT_ID", "YOUR_CLIENT_SECRET")
data = client.get("/users")`}
      />
    </div>
  )
}

function ErrorHandlingExample() {
  return (
    <div className="space-y-3">
      <CodeBlock
        language="javascript"
        title="完整的錯誤處理（JavaScript）"
        code={`async function callAPI(endpoint, options = {}) {
  const response = await fetch(endpoint, {
    ...options,
    headers: {
      'Authorization': 'Bearer ' + getToken(),
      'Accept': 'application/json',
      ...options.headers,
    },
  });

  if (response.ok) {
    return response.json();
  }

  const error = await response.json().catch(() => ({}));

  switch (response.status) {
    case 401:
      // Token expired — refresh and retry
      await refreshToken();
      return callAPI(endpoint, options);

    case 429: {
      // Rate limited — wait and retry
      const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      return callAPI(endpoint, options);
    }

    case 503:
      // Circuit breaker open — back off
      console.warn('Service temporarily unavailable:', error.message);
      throw new Error('SERVICE_UNAVAILABLE');

    default:
      throw new Error(error.message || 'API request failed');
  }
}`}
      />
    </div>
  )
}
