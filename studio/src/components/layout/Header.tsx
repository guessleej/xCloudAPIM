import { Link, useLocation } from 'react-router-dom'
import { Layers, ChevronRight } from 'lucide-react'
import { useStudioStore } from '../../stores/studio.ts'

export default function Header() {
  const { api, isDirty } = useStudioStore()
  const location = useLocation()
  const inEditor = location.pathname.includes('/policies')

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3 flex-shrink-0">
      <Link to="/" className="flex items-center gap-2 font-semibold text-gray-900 hover:text-blue-600">
        <Layers size={20} className="text-blue-600" />
        <span>Policy Studio</span>
      </Link>

      {inEditor && api && (
        <>
          <ChevronRight size={16} className="text-gray-400" />
          <span className="text-sm text-gray-600">{api.name}</span>
          <span className="text-xs text-gray-400">v{api.version}</span>
          <code className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-600">{api.basePath}</code>
          {isDirty && (
            <span className="ml-1 w-2 h-2 rounded-full bg-amber-400 inline-block" title="未儲存變更" />
          )}
        </>
      )}

      <div className="ml-auto flex items-center gap-3">
        <span className="text-xs text-gray-400">xCloudAPIM</span>
      </div>
    </header>
  )
}
