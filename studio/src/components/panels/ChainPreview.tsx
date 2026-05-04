/**
 * ChainPreview — 顯示目前 Policy Chain 的 JSON / DSL 預覽
 */
import { useState, useMemo } from 'react'
import { Code2, Copy, Check } from 'lucide-react'
import { useStudioStore } from '../../stores/studio.ts'
import { PHASE_ORDER } from '../../types/policy.ts'

type ViewMode = 'json' | 'yaml'

export default function ChainPreview() {
  const { chain } = useStudioStore()
  const [mode, setMode] = useState<ViewMode>('json')
  const [copied, setCopied] = useState(false)

  const content = useMemo(() => {
    if (!chain) return ''
    const ordered = PHASE_ORDER.flatMap((phase) =>
      chain.policies
        .filter((p) => p.phase === phase)
        .sort((a, b) => a.order - b.order)
        .map((p) => ({
          id:      p.id,
          type:    p.type,
          phase:   p.phase,
          enabled: p.enabled,
          order:   p.order,
          config:  p.config,
          ...(p.condition ? { condition: p.condition } : {}),
        }))
    )

    const doc = {
      apiId:    chain.apiId,
      version:  chain.version,
      policies: ordered,
    }

    if (mode === 'json') {
      return JSON.stringify(doc, null, 2)
    }
    return toYaml(doc)
  }, [chain, mode])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (!chain) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-400">
        尚未載入 Policy Chain
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-gray-950 text-gray-100 font-mono text-xs">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <div className="flex items-center gap-2 text-gray-400">
          <Code2 size={13} />
          <span className="text-gray-300 font-sans font-medium text-xs">Policy Chain DSL</span>
          <span className="text-gray-600">·</span>
          <span className="text-gray-500">{chain.policies.length} policies</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md overflow-hidden border border-gray-700">
            {(['json', 'yaml'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-2 py-0.5 text-xs transition-colors ${
                  mode === m
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`}
              >
                {m.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
          >
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            <span className="text-xs">{copied ? '已複製' : '複製'}</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <pre className="flex-1 overflow-auto p-3 leading-relaxed whitespace-pre text-green-300">
        <code>{content}</code>
      </pre>
    </div>
  )
}

// ─── Minimal YAML serialiser ─────────────────────────────────────

function toYaml(obj: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (obj === null || obj === undefined) return 'null'
  if (typeof obj === 'boolean') return String(obj)
  if (typeof obj === 'number') return String(obj)
  if (typeof obj === 'string') {
    if (/[:#{}[\],&*?|<>=!%@`]/.test(obj) || obj.includes('\n') || obj === '') {
      return `"${obj.replace(/"/g, '\\"')}"`
    }
    return obj
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]'
    return obj.map((item) => `\n${pad}- ${toYaml(item, indent + 1).trimStart()}`).join('')
  }
  if (typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    return entries
      .map(([k, v]) => {
        const val = toYaml(v, indent + 1)
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
          return `\n${pad}${k}:${val}`
        }
        if (Array.isArray(v)) {
          return `\n${pad}${k}:${val}`
        }
        return `\n${pad}${k}: ${val}`
      })
      .join('')
      .trimStart()
  }
  return String(obj)
}
