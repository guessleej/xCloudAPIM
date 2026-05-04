import Link from 'next/link'
import { ChevronRight, BookOpen, Tag } from 'lucide-react'
import Badge from '@/components/ui/Badge'

interface API {
  id:          string
  name:        string
  version:     string
  basePath:    string
  description: string | null
  status:      string
  tags:        string[]
  organization: { name: string } | null
}

interface Props { api: API }

const statusVariant: Record<string, 'success' | 'warning' | 'default'> = {
  ACTIVE: 'success', DEPRECATED: 'warning', INACTIVE: 'default',
}

export default function DocsApiHeader({ api }: Props) {
  return (
    <div>
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-400 mb-4">
        <Link href="/apis" className="hover:text-gray-600 transition-colors">API 目錄</Link>
        <ChevronRight size={13} />
        <Link href={`/apis/${api.id}`} className="hover:text-gray-600 transition-colors truncate max-w-[200px]">
          {api.name}
        </Link>
        <ChevronRight size={13} />
        <span className="text-gray-600 flex items-center gap-1">
          <BookOpen size={12} /> 文件
        </span>
      </nav>

      {/* Title row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3 mb-1.5">
            <h1 className="text-2xl font-bold text-gray-900">{api.name}</h1>
            <Badge variant={statusVariant[api.status] ?? 'default'} dot>
              {api.status}
            </Badge>
            <span className="text-xs font-mono text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
              v{api.version}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
            <span className="font-mono text-xs bg-gray-100 px-2.5 py-1 rounded-lg border border-gray-200">
              {api.basePath}
            </span>
            {api.organization && (
              <span className="text-gray-400">
                by <span className="text-gray-600">{api.organization.name}</span>
              </span>
            )}
          </div>
        </div>

        {/* Back to detail */}
        <Link
          href={`/apis/${api.id}`}
          className="text-sm text-brand-600 hover:text-brand-700 font-medium"
        >
          查看訂閱方案 →
        </Link>
      </div>

      {/* Description */}
      {api.description && (
        <p className="mt-3 text-gray-600 text-sm leading-relaxed max-w-3xl">
          {api.description}
        </p>
      )}

      {/* Tags */}
      {api.tags?.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Tag size={12} className="text-gray-400" />
          {api.tags.map((tag) => (
            <span key={tag} className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
