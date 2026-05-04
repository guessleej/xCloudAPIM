'use client'
/**
 * SpecViewer — swagger-ui-react wrapper with custom light theme
 */
import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { Loader2, FileWarning } from 'lucide-react'

const SwaggerUI = dynamic(() => import('swagger-ui-react').then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-64 text-gray-400 gap-2">
      <Loader2 size={18} className="animate-spin" />
      <span className="text-sm">載入 API 規格中...</span>
    </div>
  ),
})

interface Props {
  apiId:    string
  basePath: string
  compact?: boolean   // 精簡模式（用於詳情頁側欄）
}

export default function SpecViewer({ apiId, basePath, compact }: Props) {
  const [status, setStatus] = useState<'loading' | 'found' | 'missing'>('loading')

  useEffect(() => {
    fetch(`/api/spec/${apiId}`, { method: 'HEAD' })
      .then((r) => setStatus(r.ok ? 'found' : 'missing'))
      .catch(() => setStatus('missing'))
  }, [apiId])

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 gap-2">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">連線中...</span>
      </div>
    )
  }

  if (status === 'missing') {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-gray-400">
        <FileWarning size={28} className="opacity-50" />
        <p className="text-sm font-medium">尚未上傳 OpenAPI 規格</p>
        <div className="font-mono text-xs bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-gray-600">
          BASE URL: {basePath}
        </div>
        <p className="text-xs text-gray-400 max-w-xs text-center">
          請聯繫 API 提供者取得完整文件，或使用左側「程式碼範例」tab 開始整合。
        </p>
      </div>
    )
  }

  return (
    <>
      <style>{swaggerTheme(compact)}</style>
      <SwaggerUI
        url={`/api/spec/${apiId}`}
        docExpansion={compact ? 'none' : 'list'}
        defaultModelsExpandDepth={compact ? -1 : 0}
        displayRequestDuration
        filter
        tryItOutEnabled={!compact}
        requestInterceptor={(req) => {
          // Inject session token if available
          const m = document.cookie.match(/apim_session=([^;]+)/)
          if (m) req.headers['Authorization'] = `Bearer ${m[1]}`
          return req
        }}
      />
    </>
  )
}

// ─── Custom CSS theme ─────────────────────────────────────────

function swaggerTheme(compact?: boolean) {
  return `
    .swagger-ui .topbar,
    .swagger-ui .info .base-url { display: none !important; }

    .swagger-ui .info { margin: ${compact ? '12px 0' : '20px 0'} !important; }
    .swagger-ui .info .title { font-size: ${compact ? '18px' : '22px'} !important; font-weight: 700 !important; }

    .swagger-ui .opblock { border-radius: 10px !important; margin: 6px 0 !important; }
    .swagger-ui .opblock-tag { font-size: 13px !important; font-weight: 600 !important; border: none !important; }
    .swagger-ui .opblock-tag:hover { background: #f8fafc !important; }

    .swagger-ui .opblock.opblock-get    { border-color: #bfdbfe !important; background: #eff6ff !important; }
    .swagger-ui .opblock.opblock-post   { border-color: #bbf7d0 !important; background: #f0fdf4 !important; }
    .swagger-ui .opblock.opblock-put    { border-color: #fed7aa !important; background: #fff7ed !important; }
    .swagger-ui .opblock.opblock-patch  { border-color: #e9d5ff !important; background: #faf5ff !important; }
    .swagger-ui .opblock.opblock-delete { border-color: #fecaca !important; background: #fef2f2 !important; }

    .swagger-ui .opblock .opblock-summary { padding: 8px 12px !important; }
    .swagger-ui .opblock .opblock-summary-method { border-radius: 6px !important; min-width: 60px !important; font-size: 11px !important; }

    .swagger-ui select, .swagger-ui input[type=text], .swagger-ui textarea {
      border-radius: 8px !important; border: 1px solid #e2e8f0 !important;
    }

    .swagger-ui .btn { border-radius: 8px !important; font-size: 12px !important; }
    .swagger-ui .execute-wrapper .btn.execute { background: #2563eb !important; border-color: #2563eb !important; }

    .swagger-ui .model-box { border-radius: 8px !important; }
    .swagger-ui .response-col_status { font-weight: 600 !important; }

    .swagger-ui .filter-container input { border-radius: 8px !important; }

    /* Response highlight */
    .swagger-ui .response .microlight { border-radius: 8px !important; font-size: 12px !important; }

    ${compact ? '.swagger-ui .scheme-container { display: none !important; }' : ''}
  `
}
