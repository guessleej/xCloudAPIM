'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { useState, useTransition } from 'react'

const STATUS_OPTIONS = [
  { value: 'ACTIVE',     label: '啟用中' },
  { value: 'DEPRECATED', label: '已棄用' },
]

const TAG_OPTIONS = [
  'REST', 'GraphQL', 'Webhooks', 'Streaming', 'Internal', 'Public',
]

export default function APIListFilters() {
  const router      = useRouter()
  const params      = useSearchParams()
  const [, startTx] = useTransition()

  const [q, setQ] = useState(params.get('q') ?? '')

  const update = (key: string, val: string | null) => {
    const next = new URLSearchParams(params.toString())
    if (val) next.set(key, val)
    else next.delete(key)
    next.delete('page')
    startTx(() => router.push(`/apis?${next.toString()}`))
  }

  return (
    <div className="space-y-5">
      {/* Search */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          搜尋
        </label>
        <form onSubmit={(e) => { e.preventDefault(); update('q', q || null) }}>
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="API 名稱..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </form>
      </div>

      {/* Status */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          狀態
        </label>
        <div className="space-y-1.5">
          <button
            onClick={() => update('status', null)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              !params.get('status') ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            全部
          </button>
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => update('status', opt.value)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                params.get('status') === opt.value ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tags */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          標籤
        </label>
        <div className="flex flex-wrap gap-1.5">
          {TAG_OPTIONS.map((tag) => {
            const active = params.get('tag') === tag
            return (
              <button
                key={tag}
                onClick={() => update('tag', active ? null : tag)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  active ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {tag}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
