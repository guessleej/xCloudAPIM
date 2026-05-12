import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ExternalLink, Tag, BookOpen } from 'lucide-react'
import { getAuthClient, getRscClient } from '@/lib/apollo/client'
import { GET_API_DETAIL } from '@/lib/graphql/queries'
import { getSession } from '@/lib/auth'
import Link from 'next/link'
import Badge from '@/components/ui/Badge'
import PlanCard from '@/components/api/PlanCard'
import SpecViewer from '@/components/api/SpecViewer'

export const dynamic = 'force-dynamic'

interface Props {
  params: { id: string }
}

async function getAPI(id: string, token?: string) {
  try {
    const client = token ? getAuthClient(token) : getRscClient()
    const { data } = await client.query({
      query: GET_API_DETAIL,
      variables: { id },
    })
    return data?.api ? { ...data.api, plans: data.plans ?? [] } : null
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const api = await getAPI(params.id)
  return {
    title:       api?.name ?? 'API 詳情',
    description: api?.description ?? '',
  }
}

export default async function APIDetailPage({ params }: Props) {
  const session = await getSession()
  const api = await getAPI(params.id, session?.token)

  if (!api) notFound()

  const statusVariant: Record<string, 'success' | 'warning' | 'default'> = {
    ACTIVE: 'success', DEPRECATED: 'warning', INACTIVE: 'default',
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-gray-900">{api.name}</h1>
              <Badge variant={statusVariant[api.status] ?? 'default'} dot>
                {api.status}
              </Badge>
              <span className="text-sm text-gray-400 font-mono bg-gray-100 px-2 py-0.5 rounded">
                v{api.version}
              </span>
            </div>
            <p className="text-sm text-gray-500 font-mono">{api.basePath}</p>
            {api.org && (
              <p className="text-sm text-gray-400 mt-1">
                提供者：<span className="text-gray-600">{api.org.name}</span>
              </p>
            )}
          </div>

          {api.upstreamUrl && (
            <a
              href={api.upstreamUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <ExternalLink size={14} /> 上游服務
            </a>
          )}
        </div>

        {api.description && (
          <p className="mt-4 text-gray-600 leading-relaxed max-w-3xl">{api.description}</p>
        )}

        {api.tags?.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <Tag size={13} className="text-gray-400" />
            {api.tags.map((tag: string) => (
              <span key={tag} className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: Spec viewer + docs link */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">API 規格預覽</h2>
              <Link
                href={`/apis/${api.id}/docs`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors"
              >
                <BookOpen size={14} />
                查看完整文件
              </Link>
            </div>
            <SpecViewer apiId={api.id} basePath={api.basePath} compact />
          </div>

          {/* Docs CTA */}
          <Link
            href={`/apis/${api.id}/docs?tab=examples`}
            className="flex items-center gap-3 px-5 py-4 bg-gradient-to-r from-brand-50 to-blue-50 border border-brand-200 rounded-2xl hover:shadow-sm transition-shadow"
          >
            <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center shrink-0">
              <BookOpen size={18} className="text-white" />
            </div>
            <div>
              <p className="font-semibold text-brand-900 text-sm">程式碼範例</p>
              <p className="text-xs text-brand-600 mt-0.5">
                取得 cURL、JavaScript、Python、Go 整合範例
              </p>
            </div>
          </Link>
        </div>

        {/* Right: Plans */}
        <div>
          <h2 className="text-lg font-bold text-gray-900 mb-4">訂閱方案</h2>
          {api.plans?.length ? (
            <div className="space-y-4">
              {api.plans.map((plan: Parameters<typeof PlanCard>[0]['plan'], idx: number) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  apiId={api.id}
                  orgId={session?.orgId ?? ''}
                  isLoggedIn={!!session}
                  alreadySub={false}
                  featured={idx === 1}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400 text-sm">
              尚無可用方案
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
