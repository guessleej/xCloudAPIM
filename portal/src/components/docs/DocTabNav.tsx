'use client'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { clsx } from 'clsx'

export type DocTab = 'overview' | 'reference' | 'examples' | 'errors'

const TABS: { id: DocTab; label: string }[] = [
  { id: 'overview',  label: '概覽'       },
  { id: 'reference', label: 'API Reference' },
  { id: 'examples',  label: '程式碼範例' },
  { id: 'errors',    label: '錯誤碼'     },
]

interface Props {
  apiId: string
}

export default function DocTabNav({ apiId }: Props) {
  const params  = useSearchParams()
  const current = (params.get('tab') ?? 'overview') as DocTab

  return (
    <div className="flex items-center gap-0.5 border-b border-gray-200 px-1 overflow-x-auto scrollbar-none">
      {TABS.map(({ id, label }) => {
        const href = id === 'overview'
          ? `/apis/${apiId}/docs`
          : `/apis/${apiId}/docs?tab=${id}`
        const active = current === id

        return (
          <Link
            key={id}
            href={href}
            className={clsx(
              'flex-shrink-0 px-4 py-3 text-sm font-medium transition-colors relative',
              active
                ? 'text-brand-600 after:absolute after:bottom-0 after:inset-x-0 after:h-0.5 after:bg-brand-600'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-t-lg',
            )}
          >
            {label}
          </Link>
        )
      })}
    </div>
  )
}
