export default function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-white mt-auto">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-gray-400">
            © {new Date().getFullYear()} xCloudAPIM. All rights reserved.
          </p>
          <div className="flex items-center gap-5 text-xs text-gray-400">
            <a href="/docs" className="hover:text-gray-600 transition-colors">文件</a>
            <a href="/status" className="hover:text-gray-600 transition-colors">服務狀態</a>
            <a href="/terms"  className="hover:text-gray-600 transition-colors">服務條款</a>
          </div>
        </div>
      </div>
    </footer>
  )
}
