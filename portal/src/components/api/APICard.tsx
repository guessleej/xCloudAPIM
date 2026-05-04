import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { clsx } from 'clsx'
import Badge from '@/components/ui/Badge'
import Card from '@/components/ui/Card'

interface API {
  id:           string
  name:         string
  version:      string
  basePath:     string
  description:  string | null
  status:       string
  tags:         string[]
  organization: { id: string; name: string }
}

const statusVariant: Record<string, 'success' | 'warning' | 'default'> = {
  ACTIVE:     'success',
  DEPRECATED: 'warning',
  INACTIVE:   'default',
  DRAFT:      'default',
}

export default function APICard({ api }: { api: API }) {
  return (
    <Card hover className="group flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <Link
              href={`/apis/${api.id}`}
              className="font-semibold text-gray-900 hover:text-brand-600 transition-colors group-hover:text-brand-600 truncate"
            >
              {api.name}
            </Link>
            <span className="text-xs text-gray-400 font-mono">v{api.version}</span>
          </div>
          <p className="text-xs text-gray-500 font-mono truncate">{api.basePath}</p>
        </div>
        <Badge variant={statusVariant[api.status] ?? 'default'} dot>
          {api.status}
        </Badge>
      </div>

      {/* Description */}
      {api.description && (
        <p className="text-sm text-gray-600 line-clamp-2 leading-relaxed">
          {api.description}
        </p>
      )}

      {/* Tags */}
      {api.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {api.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
              {tag}
            </span>
          ))}
          {api.tags.length > 4 && (
            <span className="px-2 py-0.5 rounded-full text-xs text-gray-400">+{api.tags.length - 4}</span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-auto pt-2 border-t border-gray-100">
        <span className="text-xs text-gray-400">{api.organization.name}</span>
        <Link
          href={`/apis/${api.id}`}
          className={clsx(
            'flex items-center gap-1 text-xs font-medium text-brand-600',
            'opacity-0 group-hover:opacity-100 transition-opacity',
          )}
        >
          查看詳情 <ArrowRight size={12} />
        </Link>
      </div>
    </Card>
  )
}
