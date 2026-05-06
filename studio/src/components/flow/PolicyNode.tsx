import { memo } from 'react'
import { type NodeProps, type Node } from '@xyflow/react'
import { GripVertical, Trash2, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { useStudioStore } from '../../stores/studio.ts'
import { PLUGIN_REGISTRY } from '../../types/policy.ts'
import type { PolicyDef } from '../../types/policy.ts'
import Toggle from '../ui/Toggle.tsx'
import PluginIcon from '../panels/library/PluginIcon.tsx'

export interface PolicyNodeData extends Record<string, unknown> {
  policy: PolicyDef
}

export type PolicyNodeType = Node<PolicyNodeData, 'policy'>

function PolicyNode({ data, selected }: NodeProps<PolicyNodeType>) {
  const { policy } = data
  const meta = PLUGIN_REGISTRY.find((p) => p.type === policy.type)
  const { selectPolicy, removePolicy, updatePolicy } = useStudioStore()

  if (!meta) return null

  return (
    <div
      onClick={() => selectPolicy(policy.id)}
      className={clsx(
        'group relative w-56 rounded-xl border-2 shadow-sm cursor-pointer transition-all duration-150',
        'bg-white hover:shadow-md',
        selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200',
        !policy.enabled && 'opacity-50',
      )}
    >
      {/* Drag handle */}
      <div className="absolute left-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-40 text-gray-400">
        <GripVertical size={14} />
      </div>

      <div className="p-3 pl-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span className={clsx(
              'w-7 h-7 rounded-lg flex items-center justify-center',
              meta.color,
            )}>
              <PluginIcon name={meta.lucideIcon} size={14} className={meta.textColor} />
            </span>
            <span className="font-medium text-sm text-gray-800">{meta.label}</span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); removePolicy(policy.id) }}
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all p-0.5 rounded"
          >
            <Trash2 size={13} />
          </button>
        </div>

        {/* Config summary */}
        <p className="text-xs text-gray-500 leading-relaxed mb-2 min-h-[1.5rem] line-clamp-2">
          {summarizeConfig(policy)}
        </p>

        {/* Footer */}
        <div
          className="flex items-center justify-between"
          onClick={(e) => e.stopPropagation()}
        >
          <Toggle
            checked={policy.enabled}
            onChange={(v) => updatePolicy(policy.id, { enabled: v })}
          />
          {policy.condition && (
            <span className="flex items-center gap-1 text-xs text-amber-600">
              <AlertCircle size={11} /> 條件
            </span>
          )}
          <span className="text-xs text-gray-400">#{policy.order + 1}</span>
        </div>
      </div>
    </div>
  )
}

function summarizeConfig(policy: PolicyDef): string {
  const cfg = policy.config
  switch (policy.type) {
    case 'auth':
      return `方法: ${cfg['methods'] ?? 'jwt'}`
    case 'rate_limit':
      return `${cfg['strategy'] ?? 'sliding'} · ${cfg['rpm'] ?? '?'} RPM`
    case 'cors':
      return `Origins: ${cfg['allowed_origins'] ?? '*'}`
    case 'ip_whitelist':
      return `模式: ${cfg['mode'] ?? 'whitelist'}`
    case 'transform':
      return '標頭 / 請求體轉換'
    case 'cache':
      return `TTL: ${cfg['ttl'] ?? '60'}s · key: ${cfg['key_by'] ?? 'path'}`
    case 'circuit_breaker':
      return `閾值: ${cfg['threshold'] ?? '5'} · 超時: ${cfg['timeout'] ?? '30'}s`
    default:
      return ''
  }
}

export default memo(PolicyNode)
