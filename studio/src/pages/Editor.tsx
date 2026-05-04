/**
 * Editor — Policy Chain 編輯器主頁
 * 左：PolicyLibrary | 中：PolicyCanvas | 右：ConfigPanel
 * 底部：ChainPreview（可摺疊） + Deploy 按鈕
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@apollo/client'
import {
  ArrowLeft, Save, Rocket, RefreshCw, AlertCircle,
  ChevronDown, ChevronUp, Eye,
} from 'lucide-react'
import { GET_API_WITH_CHAIN, PUBLISH_POLICY_CHAIN, INVALIDATE_POLICY_CACHE } from '../graphql/queries.ts'
import { useStudioStore } from '../stores/studio.ts'
import PolicyLibrary from '../components/panels/PolicyLibrary.tsx'
import PolicyCanvas from '../components/flow/PolicyCanvas.tsx'
import ConfigPanel from '../components/panels/ConfigPanel.tsx'
import ChainPreview from '../components/panels/ChainPreview.tsx'
import Button from '../components/ui/Button.tsx'
import type { PolicyDef } from '../types/policy.ts'

export default function Editor() {
  const { apiId } = useParams<{ apiId: string }>()
  const navigate = useNavigate()
  const [showPreview, setShowPreview] = useState(false)
  const [deployError, setDeployError] = useState<string | null>(null)
  const [deploySuccess, setDeploySuccess] = useState(false)
  const loadedRef = useRef<string | null>(null)

  const { chain, isDirty, isSaving, loadChain, setSaving, markClean } = useStudioStore()

  // ── Load API + chain ─────────────────────────────────────────
  const { data, loading, error, refetch } = useQuery(GET_API_WITH_CHAIN, {
    variables: { id: apiId },
    skip: !apiId,
    fetchPolicy: 'network-only',
  })

  useEffect(() => {
    if (!data?.api || loadedRef.current === apiId) return
    loadedRef.current = apiId ?? null

    const api = data.api
    const rawChain = api.policyChain

    loadChain(
      {
        id:          api.id,
        name:        api.name,
        version:     api.version ?? '',
        basePath:    api.basePath,
        upstreamUrl: api.upstreamUrl ?? '',
        description: api.description ?? null,
        status:      api.status ?? '',
        orgId:       api.orgId ?? '',
        tags:        api.tags ?? [],
        policyChain: null,
      },
      rawChain
        ? {
            chainId:   rawChain.chainId,
            apiId:     api.id,
            version:   rawChain.version ?? 0,
            etag:      rawChain.etag ?? '',
            updatedAt: rawChain.updatedAt ?? new Date().toISOString(),
            policies:  (rawChain.policies ?? []) as PolicyDef[],
          }
        : null,
    )
  }, [data, apiId, loadChain])

  // ── Publish mutation ─────────────────────────────────────────
  const [publishChain] = useMutation(PUBLISH_POLICY_CHAIN)
  const [invalidateCache] = useMutation(INVALIDATE_POLICY_CACHE)

  const handleDeploy = useCallback(async () => {
    if (!chain || !apiId) return
    setDeployError(null)
    setDeploySuccess(false)
    setSaving(true)

    try {
      const input = {
        policies: chain.policies.map((p) => ({
          id:        p.id,
          type:      p.type,
          phase:     p.phase,
          order:     p.order,
          enabled:   p.enabled,
          config:    p.config,
          condition: p.condition ?? null,
        })),
      }

      const { data: pubData } = await publishChain({ variables: { apiId, input } })
      await invalidateCache({ variables: { apiId } })

      if (pubData?.publishPolicyChain) {
        markClean(pubData.publishPolicyChain)
      }
      setDeploySuccess(true)
      setTimeout(() => setDeploySuccess(false), 3000)

      loadedRef.current = null
      refetch()
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : '發佈失敗')
    } finally {
      setSaving(false)
    }
  }, [chain, apiId, publishChain, invalidateCache, markClean, setSaving, refetch])

  // ── Keyboard shortcut: Cmd+S ──────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleDeploy()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleDeploy])

  // ── Render states ─────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        載入 API 資訊中...
      </div>
    )
  }

  if (error || !data?.api) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm">
        <AlertCircle size={24} className="text-red-400" />
        <p className="text-gray-600">{error?.message ?? '找不到 API'}</p>
        <Button variant="secondary" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft size={14} /> 返回列表
        </Button>
      </div>
    )
  }

  const api = data.api

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="text-gray-400 hover:text-gray-600 p-1 rounded transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <span className="font-semibold text-sm text-gray-900">{api.name}</span>
            <span className="text-gray-400 text-xs ml-2 font-mono">{api.basePath}</span>
          </div>
          {isDirty && (
            <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
              未儲存
            </span>
          )}
          {chain && (
            <span className="text-xs text-gray-400">
              v{chain.version} · {chain.policies.length} policies
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {deployError && (
            <span className="text-xs text-red-600 flex items-center gap-1">
              <AlertCircle size={12} /> {deployError}
            </span>
          )}
          {deploySuccess && (
            <span className="text-xs text-green-600">✓ 發佈成功</span>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPreview((v) => !v)}
            className="gap-1"
          >
            <Eye size={13} />
            {showPreview ? '隱藏預覽' : '顯示 DSL'}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => { loadedRef.current = null; refetch() }}
            title="重新載入"
          >
            <RefreshCw size={13} />
          </Button>

          <Button
            variant="primary"
            size="sm"
            loading={isSaving}
            disabled={!isDirty || isSaving}
            onClick={handleDeploy}
            className="gap-1.5"
          >
            <Rocket size={13} />
            發佈 Policy Chain
          </Button>
        </div>
      </div>

      {/* Main editor area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Library */}
        <PolicyLibrary />

        {/* Center: Canvas */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <PolicyCanvas />
          </div>

          {/* Bottom: DSL Preview (collapsible) */}
          {showPreview && (
            <div className="h-56 border-t border-gray-200 flex-shrink-0">
              <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900 border-b border-gray-800">
                <span className="text-xs text-gray-400 font-sans">DSL Preview</span>
                <button
                  onClick={() => setShowPreview(false)}
                  className="text-gray-500 hover:text-gray-300 transition-colors"
                >
                  <ChevronDown size={14} />
                </button>
              </div>
              <div className="h-[calc(100%-32px)]">
                <ChainPreview />
              </div>
            </div>
          )}

          {!showPreview && (
            <button
              onClick={() => setShowPreview(true)}
              className="flex items-center gap-1.5 justify-center py-1 bg-gray-50 border-t border-gray-200 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <ChevronUp size={12} />
              顯示 DSL Preview
            </button>
          )}
        </div>

        {/* Right: Config */}
        <ConfigPanel />
      </div>
    </div>
  )
}
