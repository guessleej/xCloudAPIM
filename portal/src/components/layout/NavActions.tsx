'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { User, LogOut, LayoutDashboard, ChevronDown } from 'lucide-react'
import type { SessionUser } from '@/lib/auth'
import Button from '@/components/ui/Button'

interface Props {
  session: SessionUser | null
}

export default function NavActions({ session }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleLogout = async () => {
    setLoading(true)
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/')
    router.refresh()
  }

  if (!session) {
    return (
      <div className="flex items-center gap-2">
        <Link href="/auth/login" className="px-3.5 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors">
          登入
        </Link>
        <Link href="/auth/register" className="px-3.5 py-1.5 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors">
          免費註冊
        </Link>
      </div>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
      >
        <div className="w-7 h-7 rounded-full bg-brand-600 flex items-center justify-center text-white text-xs font-semibold">
          {session.name?.[0]?.toUpperCase() ?? 'U'}
        </div>
        <span className="hidden sm:block max-w-[120px] truncate">{session.name}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1.5 w-56 z-20 bg-white rounded-xl shadow-lg border border-gray-200 py-1.5 animate-slide-down">
            <div className="px-3 py-2 border-b border-gray-100 mb-1">
              <p className="text-sm font-semibold text-gray-900 truncate">{session.name}</p>
              <p className="text-xs text-gray-500 truncate">{session.email}</p>
            </div>

            <Link
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <LayoutDashboard size={15} className="text-gray-400" />
              我的控制台
            </Link>

            <Link
              href="/dashboard/subscriptions"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <User size={15} className="text-gray-400" />
              我的訂閱
            </Link>

            <div className="border-t border-gray-100 mt-1 pt-1">
              <button
                onClick={handleLogout}
                disabled={loading}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut size={15} />
                {loading ? '登出中...' : '登出'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
