import { Outlet } from 'react-router-dom'
import Header from './Header.tsx'

export default function Layout() {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
