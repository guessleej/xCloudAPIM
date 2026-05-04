/**
 * PolicyLibrary — 左側 Plugin 節點庫
 *
 * 功能：
 *  - 搜尋過濾（名稱 / 描述 / docs）
 *  - 分類 tabs（全部 | 安全 | 流量 | 轉換 | 穩定性）
 *  - 每個 plugin 顯示 PluginCard（有展開詳情、快速新增、拖曳）
 *  - 底部「已使用」摘要欄
 */
import { useState, useMemo } from 'react'
import { Search, X, Package } from 'lucide-react'
import { clsx } from 'clsx'
import { useStudioStore } from '../../stores/studio.ts'
import {
  PLUGIN_REGISTRY,
  PLUGIN_CATEGORY_LABELS,
  PHASE_ORDER,
  PHASE_LABELS,
  type PluginCategory,
  type PolicyPhase,
  type PolicyType,
} from '../../types/policy.ts'
import PluginCard from './library/PluginCard.tsx'

type TabValue = 'all' | PluginCategory

const TABS: Array<{ value: TabValue; label: string }> = [
  { value: 'all',         label: '全部' },
  { value: 'security',    label: PLUGIN_CATEGORY_LABELS.security },
  { value: 'traffic',     label: PLUGIN_CATEGORY_LABELS.traffic },
  { value: 'transform',   label: PLUGIN_CATEGORY_LABELS.transform },
  { value: 'reliability', label: PLUGIN_CATEGORY_LABELS.reliability },
]

export default function PolicyLibrary() {
  const { api, chain, addPolicy } = useStudioStore()
  const [search, setSearch] = useState('')
  const [tab, setTab]       = useState<TabValue>('all')

  // Count usage per type in current chain
  const usageCounts = useMemo<Record<PolicyType, number>>(() => {
    const counts = {} as Record<PolicyType, number>
    for (const p of (chain?.policies ?? [])) {
      counts[p.type] = (counts[p.type] ?? 0) + 1
    }
    return counts
  }, [chain?.policies])

  // Filter + sort registry
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return PLUGIN_REGISTRY.filter((meta) => {
      if (tab !== 'all' && meta.category !== tab) return false
      if (!q) return true
      return (
        meta.label.toLowerCase().includes(q) ||
        meta.description.toLowerCase().includes(q) ||
        meta.docs.toLowerCase().includes(q) ||
        meta.type.toLowerCase().includes(q)
      )
    })
  }, [search, tab])

  // ── Empty state (no API selected) ───────────────────────────
  if (!api) {
    return (
      <aside className="w-64 border-r border-gray-200 bg-white flex items-center justify-center p-6">
        <div className="text-center">
          <Package size={28} className="mx-auto mb-2 text-gray-300" />
          <p className="text-sm text-gray-400">選擇 API 以開始編輯政策鏈</p>
        </div>
      </aside>
    )
  }

  const totalUsed = chain?.policies.length ?? 0

  return (
    <aside className="w-64 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="px-3 pt-3 pb-2 border-b border-gray-100 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Plugin 庫
          </h2>
          <span className="text-xs text-gray-400">{PLUGIN_REGISTRY.length} 個插件</span>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="搜尋插件..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-7 pr-6 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={11} />
            </button>
          )}
        </div>

        {/* Category tabs */}
        <div className="flex gap-0.5 overflow-x-auto scrollbar-none">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={clsx(
                'flex-shrink-0 px-2 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap',
                tab === t.value
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Plugin list ─────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <Search size={20} className="mx-auto mb-2 opacity-40" />
            <p className="text-xs">找不到「{search}」</p>
          </div>
        ) : (
          filtered.map((meta) => (
            <PluginCard
              key={meta.type}
              meta={meta}
              usageCount={usageCounts[meta.type] ?? 0}
              onAdd={(phase) => addPolicy(meta.type, phase)}
            />
          ))
        )}
      </div>

      {/* ── Footer: usage summary ───────────────────────────── */}
      <div className="border-t border-gray-100 px-3 py-2.5 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-gray-500">已使用</span>
          <span className="text-[11px] text-gray-400">{totalUsed} policies</span>
        </div>

        {totalUsed > 0 && (
          <PhaseBreakdown chain={chain} />
        )}

        {/* QuickAdd row */}
        <QuickAddRow onAdd={addPolicy} />
      </div>
    </aside>
  )
}

// ─── Phase breakdown mini chart ──────────────────────────────

function PhaseBreakdown({ chain }: { chain: import('../../types/policy.ts').PolicyChain | null }) {
  if (!chain) return null
  const total = chain.policies.length
  if (total === 0) return null

  const counts: Record<PolicyPhase, number> = {
    PRE_REQUEST: 0, POST_REQUEST: 0, PRE_RESPONSE: 0, POST_RESPONSE: 0,
  }
  for (const p of chain.policies) counts[p.phase]++

  const BAR_COLOR: Record<PolicyPhase, string> = {
    PRE_REQUEST:   'bg-blue-400',
    POST_REQUEST:  'bg-green-400',
    PRE_RESPONSE:  'bg-purple-400',
    POST_RESPONSE: 'bg-orange-400',
  }

  return (
    <div className="space-y-1">
      {PHASE_ORDER.filter((ph) => counts[ph] > 0).map((ph) => (
        <div key={ph} className="flex items-center gap-1.5">
          <div className={clsx('h-1.5 rounded-full transition-all', BAR_COLOR[ph])}
            style={{ width: `${(counts[ph] / total) * 100}%`, minWidth: 4 }} />
          <span className="text-[10px] text-gray-400 truncate whitespace-nowrap">
            {PHASE_LABELS[ph].replace('-', '\u2011')} ({counts[ph]})
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Quick-add dropdown per phase ─────────────────────────────

function QuickAddRow({ onAdd }: {
  onAdd: (type: PolicyType, phase: PolicyPhase) => void
}) {
  const [openPhase, setOpenPhase] = useState<PolicyPhase | null>(null)

  return (
    <div>
      <p className="text-[10px] font-medium text-gray-400 mb-1">快速新增到 Phase</p>
      <div className="grid grid-cols-2 gap-1">
        {PHASE_ORDER.map((phase) => (
          <div key={phase} className="relative">
            <button
              onClick={() => setOpenPhase(openPhase === phase ? null : phase)}
              className={clsx(
                'w-full text-left text-[11px] px-2 py-1 rounded-md border transition-colors',
                openPhase === phase
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700',
              )}
            >
              + {PHASE_LABELS[phase].replace('-', '\u2011')}
            </button>

            {openPhase === phase && (
              <>
                {/* Backdrop */}
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setOpenPhase(null)}
                />
                <div className={clsx(
                  'absolute z-20 bg-white rounded-xl shadow-xl border border-gray-200 p-1.5 w-48',
                  // position above or below based on phase index
                  'bottom-full mb-1 left-0',
                )}>
                  <p className="text-[10px] font-medium text-gray-400 px-2 py-1">
                    新增到 {PHASE_LABELS[phase]}
                  </p>
                  {PLUGIN_REGISTRY.filter((m) => m.compatiblePhases.includes(phase)).map((meta) => (
                    <button
                      key={meta.type}
                      onClick={() => { onAdd(meta.type, phase); setOpenPhase(null) }}
                      className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-xs text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <span className={clsx(
                        'w-5 h-5 rounded flex items-center justify-center',
                        meta.color,
                      )}>
                        <span className="text-[11px]">{meta.icon}</span>
                      </span>
                      {meta.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
