import { redirect } from 'next/navigation'
import Link from 'next/link'
import { LayoutDashboard, Layers, Key, BarChart3 } from 'lucide-react'
import { getSession } from '@/lib/auth'

const NAV = [
  { href: '/dashboard',               icon: LayoutDashboard, label: '總覽' },
  { href: '/dashboard/subscriptions', icon: Layers,          label: '我的訂閱' },
  { href: '/dashboard/keys',          icon: Key,             label: 'API Keys' },
  { href: '/dashboard/usage',         icon: BarChart3,       label: '用量分析' },
]

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/auth/login?next=/dashboard')

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex gap-8">
        {/* Sidebar */}
        <aside className="hidden lg:block w-56 shrink-0">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-3 sticky top-20">
            <div className="px-3 py-2 mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">控制台</p>
            </div>
            <nav className="space-y-0.5">
              {NAV.map(({ href, icon: Icon, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                >
                  <Icon size={16} className="text-gray-400" />
                  {label}
                </Link>
              ))}
            </nav>

            <div className="border-t border-gray-100 mt-3 pt-3 px-3">
              <p className="text-xs text-gray-500 truncate">{session.email}</p>
              <p className="text-xs font-medium text-gray-700 truncate">{session.name}</p>
            </div>
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  )
}
