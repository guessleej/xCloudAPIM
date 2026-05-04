import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getAuthClient } from '@/lib/apollo/client'
import { GET_SUBSCRIPTION_DETAIL } from '@/lib/graphql/queries'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import APIKeyCard from '@/components/dashboard/APIKeyCard'
import CreateAPIKeyButton from '@/components/dashboard/CreateAPIKeyButton'

export const metadata: Metadata = { title: 'API Key 管理' }

interface Props { params: { subId: string } }

export default async function KeysPage({ params }: Props) {
  const session = await getSession()
  if (!session) return null

  let subscription: {
    id: string; appName: string; status: string
    plan: {
      name: string; description: string | null
      rateLimit: { rpm: number; rph: number; rpd: number } | null
      api: { id: string; name: string; basePath: string; version: string; description: string | null }
    }
    apiKeys: Array<{ id: string; name: string; keyPrefix: string; status: string; createdAt: string; lastUsedAt: string | null }>
  } | null = null

  try {
    const { data } = await getAuthClient(session.token).query({
      query: GET_SUBSCRIPTION_DETAIL,
      variables: { id: params.subId },
      context: { fetchOptions: { cache: 'no-store' } },
    })
    subscription = data?.subscription ?? null
  } catch { /* handled below */ }

  if (!subscription) notFound()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{subscription.appName}</h1>
        <div className="flex flex-wrap items-center gap-2 mt-1.5">
          <Badge
            variant={subscription.status === 'ACTIVE' ? 'success' : 'default'}
            dot
          >
            {subscription.status}
          </Badge>
          <span className="text-sm text-gray-500">
            {subscription.plan?.api?.name} · {subscription.plan?.name}
          </span>
          <span className="text-xs font-mono text-gray-400">{subscription.plan?.api?.basePath}</span>
        </div>
      </div>

      {/* Rate limits */}
      {subscription.plan?.rateLimit && (
        <Card>
          <h2 className="font-semibold text-sm text-gray-700 mb-3">速率限制</h2>
          <div className="flex flex-wrap gap-4">
            {[
              { label: 'RPM', value: subscription.plan.rateLimit.rpm },
              { label: 'RPH', value: subscription.plan.rateLimit.rph },
              { label: 'RPD', value: subscription.plan.rateLimit.rpd },
            ].filter((x) => x.value).map(({ label, value }) => (
              <div key={label} className="text-center">
                <div className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</div>
                <div className="text-xs text-gray-500">{label}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* API Keys */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">
            API Keys ({subscription.apiKeys.length})
          </h2>
          <CreateAPIKeyButton subscriptionId={subscription.id} />
        </div>

        {subscription.apiKeys.length === 0 ? (
          <Card className="text-center py-10 text-gray-400">
            <p className="mb-3">尚無 API Key</p>
            <CreateAPIKeyButton subscriptionId={subscription.id} primary />
          </Card>
        ) : (
          <div className="space-y-3">
            {subscription.apiKeys.map((key) => (
              <APIKeyCard key={key.id} apiKey={key} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
