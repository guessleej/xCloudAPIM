import type { Metadata } from 'next'
import Link from 'next/link'
import { Layers, Key, ArrowRight, Zap } from 'lucide-react'
import { getSession } from '@/lib/auth'
import { getAuthClient } from '@/lib/apollo/client'
import { GET_MY_SUBSCRIPTIONS } from '@/lib/graphql/queries'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'

export const metadata: Metadata = { title: '控制台總覽' }
export const dynamic = 'force-dynamic'

async function getSubscriptions(token: string) {
  try {
    const client = getAuthClient(token)
    const { data } = await client.query({
      query:   GET_MY_SUBSCRIPTIONS,
      context: { fetchOptions: { cache: 'no-store' } },
    })
    return data?.subscriptions?.nodes ?? []
  } catch {
    return []
  }
}

export default async function DashboardPage() {
  const session = await getSession()
  if (!session) return null

  const subscriptions = await getSubscriptions(session.token)
  const activeCount   = subscriptions.filter((s: { status: string }) => s.status === 'ACTIVE').length
  const keyCount      = subscriptions.reduce((acc: number, s: { apiKeys: unknown[] }) => acc + (s.apiKeys?.length ?? 0), 0)

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          你好，{session.name.split(' ')[0]} 👋
        </h1>
        <p className="text-gray-500 mt-1">管理您的 API 訂閱與金鑰</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: '啟用中訂閱',  value: activeCount,                 icon: Layers,  color: 'text-blue-600',  bg: 'bg-blue-50' },
          { label: '總 API Keys', value: keyCount,                    icon: Key,     color: 'text-green-600', bg: 'bg-green-50' },
          { label: '訂閱數合計',  value: subscriptions.length,        icon: Zap,     color: 'text-purple-600', bg: 'bg-purple-50' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label} className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
              <Icon size={22} className={color} />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{value}</p>
              <p className="text-sm text-gray-500">{label}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Recent subscriptions */}
      <Card padding="none">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">最近訂閱</h2>
          <Link href="/dashboard/subscriptions" className="flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
            查看全部 <ArrowRight size={13} />
          </Link>
        </div>

        {subscriptions.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Layers size={28} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">尚無訂閱</p>
            <Link href="/apis" className="text-sm text-brand-600 hover:underline mt-1 block">
              瀏覽 API 目錄
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {subscriptions.slice(0, 5).map((sub: {
              id: string; status: string
              plan: { name: string } | null
              api: { name: string; basePath: string } | null
            }) => (
              <div key={sub.id} className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors">
                <div>
                  <p className="font-medium text-sm text-gray-900">{sub.api?.name ?? 'API 訂閱'}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {sub.api?.basePath} · {sub.plan?.name}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge
                    variant={sub.status === 'ACTIVE' ? 'success' : sub.status === 'SUSPENDED' ? 'warning' : 'default'}
                    dot
                  >
                    {sub.status}
                  </Badge>
                  <Link href={`/dashboard/keys/${sub.id}`} className="text-xs text-brand-600 hover:text-brand-700">
                    管理 →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
