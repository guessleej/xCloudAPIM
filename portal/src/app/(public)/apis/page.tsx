import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getRscClient } from '@/lib/apollo/client'
import { GET_PUBLIC_APIS } from '@/lib/graphql/queries'
import APICard from '@/components/api/APICard'
import APIListFilters from '@/components/api/APIListFilters'

export const metadata: Metadata = { title: 'API 目錄' }
export const revalidate = 30

interface SearchParams {
  q?:      string
  tag?:    string
  status?: string
  page?:   string
}

async function getAPIs(params: SearchParams) {
  const page  = Number(params.page ?? 1)
  const limit = 12
  try {
    const { data } = await getRscClient().query({
      query:     GET_PUBLIC_APIS,
      variables: {
        limit, page,
        filter: {
          ...(params.status ? { status: params.status } : { status: 'ACTIVE' }),
          ...(params.q  ? { search: params.q }  : {}),
          ...(params.tag ? { tag: params.tag }  : {}),
        },
      },
    })
    return data?.apis ?? { nodes: [], pageInfo: { page: 1, total: 0, totalPages: 1, hasNext: false } }
  } catch {
    return { nodes: [], pageInfo: { page: 1, total: 0, totalPages: 1, hasNext: false } }
  }
}

export default async function APIsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { nodes: apis, pageInfo } = await getAPIs(searchParams)
  const currentPage = pageInfo.page ?? 1

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">API 目錄</h1>
        <p className="text-gray-500 mt-2">
          共 {pageInfo.total} 個 API 服務
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Filters sidebar */}
        <aside className="lg:w-60 shrink-0">
          <Suspense>
            <APIListFilters />
          </Suspense>
        </aside>

        {/* Grid */}
        <div className="flex-1">
          {apis.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              <p className="text-lg">找不到符合條件的 API</p>
              <p className="text-sm mt-1">請嘗試調整篩選條件</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {apis.map((api: Parameters<typeof APICard>[0]['api']) => (
                  <APICard key={api.id} api={api} />
                ))}
              </div>

              {/* Pagination */}
              {pageInfo.totalPages > 1 && (
                <div className="flex justify-center mt-10 gap-2">
                  {Array.from({ length: pageInfo.totalPages }, (_, i) => i + 1).map((p) => (
                    <a
                      key={p}
                      href={`?page=${p}${searchParams.q ? `&q=${searchParams.q}` : ''}`}
                      className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                        p === currentPage
                          ? 'bg-brand-600 text-white'
                          : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {p}
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
