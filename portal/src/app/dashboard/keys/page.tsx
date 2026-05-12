import type { Metadata } from 'next'
import Link from 'next/link'
import { Key, Layers, Plus } from 'lucide-react'
import { getSession } from '@/lib/auth'
import { getAuthClient } from '@/lib/apollo/client'
import { GET_MY_SUBSCRIPTIONS } from '@/lib/graphql/queries'
import Badge from '@/components/ui/Badge'
import Card from '@/components/ui/Card'

export const metadata: Metadata = { title: 'API Keys' }
export const dynamic = 'force-dynamic'

type Subscription = {
  id: string
  status: string
  plan: { id: string; name: string } | null
  api: { id: string; name: string; basePath: string; version: string } | null
  apiKeys: Array<{
    id: string
    name: string
    keyPrefix: string
    status: string
    createdAt: string
    lastUsedAt: string | null
    subscriptionId: string
  }>
}

export default async function APIKeysIndexPage() {
  const session = await getSession()
  if (!session) return null

  let subscriptions: Subscription[] = []
  try {
    const { data } = await getAuthClient(session.token).query({
      query:   GET_MY_SUBSCRIPTIONS,
      context: { fetchOptions: { cache: 'no-store' } },
    })
    subscriptions = data?.subscriptions?.nodes ?? []
  } catch {
    subscriptions = []
  }

  const keyCount = subscriptions.reduce((total, sub) => total + (sub.apiKeys?.length ?? 0), 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">API Keys</h1>
          <p className="text-sm text-gray-500 mt-1">
            集中查看所有訂閱的金鑰；新增或撤銷金鑰請進入對應 API 訂閱。
          </p>
        </div>
        <Link
          href="/dashboard/subscriptions"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 transition-colors"
        >
          <Plus size={14} /> 管理訂閱
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <p className="text-xs font-medium text-gray-500">總 API Keys</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{keyCount}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-gray-500">訂閱數</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{subscriptions.length}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-gray-500">啟用中訂閱</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {subscriptions.filter((sub) => sub.status === 'ACTIVE').length}
          </p>
        </Card>
      </div>

      {subscriptions.length === 0 ? (
        <Card className="text-center py-16 text-gray-400">
          <Layers size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-lg mb-2">尚無訂閱</p>
          <Link href="/apis" className="text-sm text-brand-600 hover:underline">
            瀏覽 API 目錄並建立第一個 API Key
          </Link>
        </Card>
      ) : (
        <div className="space-y-4">
          {subscriptions.map((sub) => (
            <Card key={sub.id} hover>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold text-gray-900">{sub.api?.name ?? 'API 訂閱'}</h2>
                    <Badge variant={sub.status === 'ACTIVE' ? 'success' : 'default'} dot>
                      {sub.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    {sub.api?.version ?? 'v1'}
                    <span className="text-gray-300 mx-1.5">·</span>
                    <span>{sub.plan?.name ?? '未指定方案'}</span>
                    <span className="text-gray-300 mx-1.5">·</span>
                    <span className="font-mono text-xs">{sub.api?.basePath ?? '-'}</span>
                  </p>
                </div>

                <Link
                  href={`/dashboard/keys/${sub.id}`}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                >
                  <Key size={12} /> 管理金鑰
                </Link>
              </div>

              {sub.apiKeys?.length > 0 ? (
                <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
                  {sub.apiKeys.map((key) => (
                    <div key={key.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{key.name}</p>
                        <p className="font-mono text-xs text-gray-500">{key.keyPrefix}••••</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant={key.status === 'ACTIVE' ? 'success' : 'default'} dot>
                          {key.status}
                        </Badge>
                        <span className="text-xs text-gray-400">
                          {key.lastUsedAt ? `最近使用 ${new Date(key.lastUsedAt).toLocaleDateString('zh-TW')}` : '尚未使用'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 pt-4 border-t border-gray-100 text-sm text-gray-400">
                  尚無金鑰，請進入此訂閱建立 API Key。
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
