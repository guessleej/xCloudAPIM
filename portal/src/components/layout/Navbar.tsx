import Link from 'next/link'
import { getSession } from '@/lib/auth'
import NavActions from './NavActions'

export default async function Navbar() {
  const session = await getSession()

  return (
    <header className="sticky top-0 z-40 w-full border-b border-gray-200 bg-white/90 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              </svg>
            </div>
            <div className="hidden sm:block">
              <span className="font-bold text-gray-900">xCloudAPIM</span>
              <span className="ml-1.5 text-xs font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">Dev Portal</span>
            </div>
          </Link>

          {/* Nav links */}
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/apis" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
              API 目錄
            </Link>
            <Link href="/docs" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
              文件
            </Link>
          </nav>

          {/* Auth actions (client component) */}
          <NavActions session={session} />
        </div>
      </div>
    </header>
  )
}
