'use client'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Mail, Lock, Eye, EyeOff } from 'lucide-react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

export default function LoginForm() {
  const router     = useRouter()
  const params     = useSearchParams()
  const next       = params.get('next') ?? '/dashboard'

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) { setError('請填寫所有欄位'); return }
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.message ?? '登入失敗'); return }
      router.push(next)
      router.refresh()
    } catch {
      setError('網路錯誤，請稍後再試')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Input
        label="電子郵件"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        autoComplete="email"
        icon={<Mail size={14} />}
        required
      />

      <div>
        <div className="relative">
          <Input
            label="密碼"
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            icon={<Lock size={14} />}
            required
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="absolute right-3 top-[38px] text-gray-400 hover:text-gray-600"
          >
            {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        <div className="text-right mt-1.5">
          <Link href="/auth/forgot" className="text-xs text-brand-600 hover:text-brand-700">
            忘記密碼？
          </Link>
        </div>
      </div>

      {error && (
        <div className="px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <Button type="submit" variant="primary" fullWidth loading={loading}>
        登入
      </Button>

      <p className="text-center text-sm text-gray-500">
        還沒有帳號？{' '}
        <Link href="/auth/register" className="text-brand-600 font-medium hover:text-brand-700">
          免費註冊
        </Link>
      </p>
    </form>
  )
}
