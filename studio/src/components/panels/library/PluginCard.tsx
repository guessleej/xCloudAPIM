/**
 * PluginCard — Policy Library 的主要節點元件
 *
 * 功能：
 *  - 拖曳到 Canvas（DragEvent 帶 type + defaultPhase）
 *  - Hover 展開：docs 說明、相容 Phase 標籤、快速新增按鈕群
 *  - Usage count badge（已在鏈中使用次數）
 *  - 鍵盤可及（Enter / Space 展開快速新增）
 */
import { useState, useRef } from 'react'
import { clsx } from 'clsx'
import { GripVertical, Plus, ChevronDown } from 'lucide-react'
import {
  type PolicyPluginMeta,
  type PolicyPhase,
  PHASE_LABELS,
  PLUGIN_CATEGORY_LABELS,
  PLUGIN_CATEGORY_COLORS,
} from '../../../types/policy.ts'
import PluginIcon from './PluginIcon.tsx'
import UsageBadge from './UsageBadge.tsx'
import PhaseTag from './PhaseTag.tsx'

interface Props {
  meta:       PolicyPluginMeta
  usageCount: number
  onAdd:      (phase: PolicyPhase) => void
  compact?:   boolean   // 搜尋結果模式：不顯示 docs 與相容 phases
}

export default function PluginCard({ meta, usageCount, onAdd, compact }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('policy-type', meta.type)
    e.dataTransfer.setData('policy-phase', meta.defaultPhase)
    e.dataTransfer.effectAllowed = 'copy'

    // Custom drag image: clone the card at reduced opacity
    if (cardRef.current) {
      const ghost = cardRef.current.cloneNode(true) as HTMLElement
      ghost.style.cssText = `
        position: fixed; top: -1000px; left: 0;
        width: ${cardRef.current.offsetWidth}px;
        opacity: 0.85; pointer-events: none;
        transform: rotate(2deg) scale(0.95);
      `
      document.body.appendChild(ghost)
      e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, 28)
      requestAnimationFrame(() => document.body.removeChild(ghost))
    }
    setIsDragging(true)
  }

  return (
    <div
      ref={cardRef}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={() => setIsDragging(false)}
      className={clsx(
        'group relative rounded-xl border transition-all duration-150 select-none',
        'cursor-grab active:cursor-grabbing',
        isDragging
          ? 'opacity-50 scale-95 border-blue-300 bg-blue-50'
          : clsx(
              'bg-white hover:shadow-sm',
              expanded
                ? clsx(meta.borderColor, 'shadow-sm')
                : 'border-gray-200 hover:border-gray-300',
            ),
      )}
    >
      {/* ── Main row ─────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 p-2.5">
        {/* Drag handle (visible on hover) */}
        <div className="opacity-0 group-hover:opacity-30 text-gray-400 flex-shrink-0 -ml-1">
          <GripVertical size={14} />
        </div>

        {/* Icon */}
        <div className={clsx(
          'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
          meta.color,
        )}>
          <PluginIcon name={meta.lucideIcon} size={15} className={meta.textColor} />
        </div>

        {/* Label + description */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={clsx('text-sm font-semibold leading-tight', meta.textColor)}>
              {meta.label}
            </span>
            <UsageBadge count={usageCount} />
          </div>
          <p className="text-[11px] text-gray-400 leading-tight mt-0.5 truncate">
            {meta.description}
          </p>
        </div>

        {/* Expand toggle */}
        {!compact && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
            className={clsx(
              'flex-shrink-0 p-0.5 rounded text-gray-300 hover:text-gray-500 transition-all',
              expanded && 'rotate-180 text-gray-500',
            )}
            aria-label={expanded ? '收合' : '展開詳情'}
          >
            <ChevronDown size={13} />
          </button>
        )}
      </div>

      {/* ── Expanded detail ───────────────────────────────── */}
      {!compact && expanded && (
        <div className="px-3 pb-3 space-y-2.5 border-t border-gray-100 pt-2.5">
          {/* Category + docs */}
          <div className="flex items-start gap-2">
            <span className={clsx(
              'text-[10px] font-medium px-1.5 py-0.5 rounded border flex-shrink-0 mt-0.5',
              PLUGIN_CATEGORY_COLORS[meta.category],
            )}>
              {PLUGIN_CATEGORY_LABELS[meta.category]}
            </span>
            <p className="text-[11px] text-gray-500 leading-relaxed">{meta.docs}</p>
          </div>

          {/* Compatible phases */}
          <div>
            <p className="text-[10px] font-medium text-gray-400 mb-1">相容執行階段</p>
            <div className="flex flex-wrap gap-1">
              {meta.compatiblePhases.map((ph) => (
                <PhaseTag key={ph} phase={ph} />
              ))}
            </div>
          </div>

          {/* Quick-add buttons */}
          <div>
            <p className="text-[10px] font-medium text-gray-400 mb-1">快速新增到</p>
            <div className="flex flex-wrap gap-1">
              {meta.compatiblePhases.map((ph) => (
                <button
                  key={ph}
                  onClick={(e) => { e.stopPropagation(); onAdd(ph) }}
                  className={clsx(
                    'flex items-center gap-0.5 px-2 py-1 rounded-lg text-[11px] font-medium',
                    'border transition-colors',
                    'hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700',
                    'text-gray-600 border-gray-200',
                  )}
                >
                  <Plus size={10} />
                  {PHASE_LABELS[ph].replace('-', '\u2011')}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Compact quick-add (shown on hover in compact mode) */}
      {compact && (
        <div className="hidden group-hover:flex absolute right-2 top-1/2 -translate-y-1/2 gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onAdd(meta.defaultPhase) }}
            className={clsx(
              'flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium',
              'bg-blue-600 text-white hover:bg-blue-700 transition-colors',
            )}
          >
            <Plus size={9} /> 新增
          </button>
        </div>
      )}
    </div>
  )
}
