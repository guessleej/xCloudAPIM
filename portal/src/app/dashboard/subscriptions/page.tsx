import type { Metadata } from 'next'
import Link from 'next/link'
import { Key, ExternalLink } from 'lucide-react'
import { getSession } from '@/lib/auth'
import { getAuthClient } from '@/lib/apollo/client'
import { GET_MY_SUBSCRIPTIONS } from '@/lib/graphql/queries'
import Badge from '@/components/ui/Badge'
import Card from '@/components/ui/Card'
import CancelSubscriptionButton from '@/components/dashboard/CancelSubscriptionButton'

export const metadata: Metadata = { title: '我的訂閱' }

type Sub = {
  id: string; status: string; createdAt: string
  plan: { id: string; name: string } | null
  api: { id: string; name: string; basePath: string; version: string } | null
  apiKeys: Array<{ id: string; name: string; keyPrefix: string; status: string }>
}

export default async function SubscriptionsPage() {
  const session = await getSession()
  if (!session) return null

  let subscriptions: Sub[] = []
  try {
    const { data } = await getAuthClient(session.token).query({
      query:   GET_MY_SUBSCRIPTIONS,
      context: { fetchOptions: { cache: 'no-store' } },
    })
    subscriptions = data?.subscriptions?.nodes ?? []
  } catch { /* handled by empty state */ }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">我的訂閱</h1>
        <Link href="/apis" className="text-sm font-medium text-brand-600 hover:text-brand-700">
          + 訂閱新 API
        </Link>
      </div>

      {subscriptions.length === 0 ? (
        <Card className="text-center py-16 text-gray-400">
          <p className="text-lg mb-2">尚無訂閱</p>
          <Link href="/apis" className="text-sm text-brand-600 hover:underline">
            瀏覽 API 目錄並訂閱
          </Link>
        </Card>
      ) : (
        <div className="space-y-4">
          {subscriptions.map((sub) => (
            <Card key={sub.id} hover>
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="font-semibold text-gray-900">{sub.api?.name ?? 'API 訂閱'}</span>
                    <Badge
                      variant={
                        sub.status === 'ACTIVE'    ? 'success' :
                        sub.status === 'SUSPENDED' ? 'warning' : 'default'
                      }
                      dot
                    >
                      {sub.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-500">
                    {sub.api?.version ?? 'v1'}
                    <span className="text-gray-300 mx-1.5">·</span>
                    <span className="font-medium text-gray-700">{sub.plan?.name}</span>
                    <span className="text-gray-300 mx-1.5">·</span>
                    <span className="font-mono text-xs">{sub.api?.basePath}</span>
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    建立於 {new Date(sub.createdAt).toLocaleDateString('zh-TW')}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/dashboard/keys/${sub.id}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                  >
                    <Key size={12} /> {sub.apiKeys?.length ?? 0} 個金鑰
                  </Link>
                  <Link
                    href={`/apis/${sub.api?.id}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    <ExternalLink size={12} /> API 文件
                  </Link>
                  {sub.status === 'ACTIVE' && (
                    <CancelSubscriptionButton subscriptionId={sub.id} />
                  )}
                </div>
              </div>

              {/* Key prefix preview */}
              {sub.apiKeys?.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-2">
                  {sub.apiKeys.slice(0, 3).map((key) => (
                    <span key={key.id} className="font-mono text-xs bg-gray-50 border border-gray-200 px-2 py-1 rounded text-gray-500">
                      {key.name}: {key.keyPrefix}••••
                    </span>
                  ))}
                  {sub.apiKeys.length > 3 && (
                    <span className="text-xs text-gray-400">+{sub.apiKeys.length - 3} more</span>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
