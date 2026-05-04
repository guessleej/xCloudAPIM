'use client'
import { useState } from 'react'
import { useMutation } from '@apollo/client'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Copy, Check, RefreshCw, Trash2, Clock } from 'lucide-react'
import { REVOKE_API_KEY, ROTATE_API_KEY } from '@/lib/graphql/mutations'
import Badge from '@/components/ui/Badge'
import Card from '@/components/ui/Card'

interface APIKey {
  id:          string
  name:        string
  keyPrefix:   string
  status:      string
  createdAt:   string
  lastUsedAt:  string | null
  plainKey?:   string   // present right after creation
}

interface Props {
  apiKey: APIKey
}

export default function APIKeyCard({ apiKey }: Props) {
  const router      = useRouter()
  const [revealed,  setRevealed]  = useState(false)
  const [copied,    setCopied]    = useState(false)
  const [plainKey,  setPlainKey]  = useState(apiKey.plainKey ?? null)
  const [confirmRevoke, setConfirmRevoke] = useState(false)

  const [revoke,  { loading: revoking }] = useMutation(REVOKE_API_KEY, {
    variables:   { id: apiKey.id },
    onCompleted: () => router.refresh(),
  })

  const [rotate, { loading: rotating }] = useMutation(ROTATE_API_KEY, {
    variables:   { id: apiKey.id },
    onCompleted: (data) => {
      setPlainKey(data.rotateAPIKey.plainKey)
      setRevealed(true)
      router.refresh()
    },
  })

  const displayKey = plainKey
    ? (revealed ? plainKey : `${apiKey.keyPrefix}${'•'.repeat(24)}`)
    : `${apiKey.keyPrefix}${'•'.repeat(24)}`

  const handleCopy = async () => {
    if (!plainKey) return
    await navigator.clipboard.writeText(plainKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const isRevoked  = apiKey.status === 'REVOKED'
  const isInactive = isRevoked || apiKey.status === 'INACTIVE'

  return (
    <Card className={isInactive ? 'opacity-60' : ''}>
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="font-semibold text-sm text-gray-900">{apiKey.name}</span>
            <Badge
              variant={apiKey.status === 'ACTIVE' ? 'success' : apiKey.status === 'REVOKED' ? 'danger' : 'default'}
            >
              {apiKey.status}
            </Badge>
          </div>

          {/* Key display */}
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 font-mono text-sm">
            <span className="flex-1 truncate text-gray-700 select-all">
              {displayKey}
            </span>
            {plainKey && (
              <>
                <button onClick={() => setRevealed((v) => !v)} className="text-gray-400 hover:text-gray-600 shrink-0">
                  {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button onClick={handleCopy} className="text-gray-400 hover:text-gray-600 shrink-0">
                  {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                </button>
              </>
            )}
          </div>

          {plainKey && (
            <p className="text-xs text-amber-600 mt-1.5 flex items-center gap-1">
              ⚠ 請立即複製金鑰，此後將無法再次查看完整金鑰
            </p>
          )}

          <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <Clock size={11} />
              建立：{new Date(apiKey.createdAt).toLocaleDateString('zh-TW')}
            </span>
            {apiKey.lastUsedAt && (
              <span className="flex items-center gap-1">
                <Clock size={11} />
                最後使用：{new Date(apiKey.lastUsedAt).toLocaleDateString('zh-TW')}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        {!isRevoked && (
          <div className="flex flex-wrap sm:flex-col gap-1.5 shrink-0">
            <button
              onClick={() => rotate()}
              disabled={rotating}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={rotating ? 'animate-spin' : ''} />
              輪換金鑰
            </button>

            {!confirmRevoke ? (
              <button
                onClick={() => setConfirmRevoke(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
              >
                <Trash2 size={12} /> 吊銷
              </button>
            ) : (
              <div className="flex gap-1">
                <button
                  onClick={() => revoke()}
                  disabled={revoking}
                  className="px-2.5 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  確定
                </button>
                <button
                  onClick={() => setConfirmRevoke(false)}
                  className="px-2.5 py-1.5 text-xs font-medium border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
                >
                  取消
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
