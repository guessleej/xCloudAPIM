import Link from 'next/link'
import { ArrowRight, Zap, Shield, BarChart3, Code2 } from 'lucide-react'
import { getAuthClient, getRscClient } from '@/lib/apollo/client'
import { GET_PUBLIC_APIS } from '@/lib/graphql/queries'
import { getSession } from '@/lib/auth'
import APICard from '@/components/api/APICard'

export const dynamic = 'force-dynamic'

async function getFeaturedAPIs(token?: string) {
  try {
    const client = token ? getAuthClient(token) : getRscClient()
    const { data } = await client.query({
      query:     GET_PUBLIC_APIS,
      variables: { limit: 6, page: 1, filter: { status: 'ACTIVE' } },
    })
    return data?.apis?.nodes ?? []
  } catch {
    return []
  }
}

export default async function HomePage() {
  const session = await getSession()
  const apis = await getFeaturedAPIs(session?.token)

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-900 via-brand-700 to-brand-500 text-white">
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-24 sm:py-32">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 text-sm font-medium mb-6">
              <Zap size={14} className="text-yellow-300" />
              Enterprise API Gateway Platform
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-6">
              建立、管理、<br className="hidden sm:block" />
              <span className="text-blue-200">擴展</span> 您的 API
            </h1>
            <p className="text-lg text-blue-100 mb-8 leading-relaxed max-w-2xl">
              透過 xCloudAPIM Developer Portal 探索所有可用 API，
              取得 API Key，並即時查看使用量分析。
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                href="/apis"
                className="inline-flex items-center gap-2 px-6 py-3 bg-white text-brand-700 font-semibold rounded-xl hover:bg-blue-50 transition-colors shadow-lg"
              >
                瀏覽 API 目錄 <ArrowRight size={16} />
              </Link>
              <Link
                href="/auth/register"
                className="inline-flex items-center gap-2 px-6 py-3 bg-brand-500/50 backdrop-blur border border-white/20 text-white font-semibold rounded-xl hover:bg-brand-500/70 transition-colors"
              >
                免費開始使用
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────── */}
      <section className="py-16 bg-white border-b border-gray-100">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { icon: Code2,    title: '快速整合',   desc: '完整的 OpenAPI 3.0 規格與互動式 Explorer' },
              { icon: Shield,   title: '安全可靠',   desc: 'JWT、API Key 多重驗證，IP 白名單保護' },
              { icon: Zap,      title: '高效能',     desc: 'Redis Cache + Circuit Breaker，確保低延遲' },
              { icon: BarChart3, title: '即時監控',  desc: '每分鐘、每小時、每日用量圖表一目瞭然' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-brand-50 mb-4">
                  <Icon size={22} className="text-brand-600" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── API Catalog preview ───────────────────────────────── */}
      <section className="py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">熱門 API</h2>
              <p className="text-gray-500 mt-1">探索平台上的精選 API 服務</p>
            </div>
            <Link href="/apis" className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700">
              查看全部 <ArrowRight size={14} />
            </Link>
          </div>

          {apis.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Code2 size={36} className="mx-auto mb-3 opacity-40" />
              <p>目前尚無公開 API</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {apis.map((api: Parameters<typeof APICard>[0]['api']) => (
                <APICard key={api.id} api={api} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────── */}
      <section className="py-16 bg-gray-900 text-white">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h2 className="text-3xl font-bold mb-4">準備好開始了嗎？</h2>
          <p className="text-gray-400 mb-8">免費註冊，立即取得 API Key 並開始整合</p>
          <Link
            href="/auth/register"
            className="inline-flex items-center gap-2 px-8 py-3.5 bg-brand-600 text-white font-semibold rounded-xl hover:bg-brand-700 transition-colors"
          >
            立即免費註冊 <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </>
  )
}
