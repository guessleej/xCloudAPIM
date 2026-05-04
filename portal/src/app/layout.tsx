import type { Metadata } from 'next'
import './globals.css'
import ApolloProvider from '@/lib/apollo/provider'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? 'xCloudAPIM Developer Portal'
const SITE_URL  = process.env.NEXT_PUBLIC_SITE_URL  ?? 'http://localhost:3001'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title:       { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description: '探索、訂閱並管理 xCloudAPIM 平台上的所有 API',
  openGraph:   { siteName: SITE_NAME, type: 'website' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className="min-h-screen flex flex-col">
        <ApolloProvider>
          <Navbar />
          <main className="flex-1">
            {children}
          </main>
          <Footer />
        </ApolloProvider>
      </body>
    </html>
  )
}
