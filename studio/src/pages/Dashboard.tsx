/**
 * Dashboard — API 列表，顯示每個 API 的 Policy Chain 狀態
 */
import { useState } from 'react'
import { useQuery } from '@apollo/client'
import { useNavigate } from 'react-router-dom'
import { Search, ExternalLink, ShieldCheck, AlertCircle, Clock, Layers } from 'lucide-react'
import { GET_APIS } from '../graphql/queries.ts'
import Badge from '../components/ui/Badge.tsx'
import Button from '../components/ui/Button.tsx'

interface ApiItem {
  id: string
  name: string
  basePath: string
  status: string
  upstreamUrl: string
  orgId: string
  policyChain: {
    chainId: string
    version: number
    policies: Array<{ id: string; type: string }>
  } | null
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const { data, loading, error } = useQuery<{ apis: { nodes: ApiItem[] } }>(GET_APIS, {
    variables: { limit: 50, page: 1 },
    fetchPolicy: 'cache-and-network',
  })

  const apis = data?.apis.nodes ?? []
  const filtered = apis.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.basePath.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="flex-1 overflow-auto bg-gray-50">
      {/* Page header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Policy Studio</h1>
            <p className="text-sm text-gray-500 mt-0.5">管理 API 的 Policy Chain 設定</p>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="搜尋 API..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-5">
        {loading && (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
            載入中...
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 rounded-lg p-4">
            <AlertCircle size={16} />
            <span>無法載入 API 列表：{error.message}</span>
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <Layers size={32} className="mb-3 opacity-40" />
            <p className="text-sm">{search ? '找不到符合的 API' : '尚無 API'}</p>
          </div>
        )}

        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((api) => (
            <ApiCard
              key={api.id}
              api={api}
              onEdit={() => navigate(`/editor/${api.id}`)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function ApiCard({ api, onEdit }: { api: ApiItem; onEdit: () => void }) {
  const chain = api.policyChain
  const totalCount = chain?.policies.length ?? 0

  const statusColor = {
    ACTIVE:      'success',
    INACTIVE:    'default',
    DEPRECATED:  'warning',
    DRAFT:       'default',
  }[api.status] as 'success' | 'warning' | 'default'

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow p-4">
      {/* Card header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-sm text-gray-900 truncate">{api.name}</h3>
            <Badge variant={statusColor} size="sm">{api.status}</Badge>
          </div>
          <p className="text-xs text-gray-400 font-mono truncate">{api.basePath}</p>
          <p className="text-xs text-gray-400 truncate mt-0.5">Org: {api.orgId}</p>
        </div>
        <a
          href={api.upstreamUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-300 hover:text-gray-500 ml-2 flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink size={13} />
        </a>
      </div>

      {/* Policy chain stats */}
      <div className="rounded-lg bg-gray-50 p-3 mb-3">
        {chain ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-gray-600">
              <ShieldCheck size={13} className="text-green-500" />
              <span>{totalCount} policies</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <Clock size={11} />
              <span>v{chain?.version}</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <AlertCircle size={13} />
            <span>尚未設定 Policy Chain</span>
          </div>
        )}

        {chain && chain.policies.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {Array.from(new Set(chain.policies.map((p) => p.type))).slice(0, 5).map((type) => (
              <span
                key={type}
                className="px-1.5 py-0.5 rounded text-xs bg-white border border-gray-200 text-gray-500"
              >
                {type}
              </span>
            ))}
            {new Set(chain.policies.map((p) => p.type)).size > 5 && (
              <span className="px-1.5 py-0.5 rounded text-xs text-gray-400">
                +{new Set(chain.policies.map((p) => p.type)).size - 5}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <Button variant="primary" size="sm" className="w-full" onClick={onEdit}>
        編輯 Policy Chain
      </Button>
    </div>
  )
}
