'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { User, Mail, Lock, Eye, EyeOff, Building2 } from 'lucide-react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

export default function RegisterForm() {
  const router = useRouter()

  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '', orgName: '' })
  const [showPw,  setShowPw]  = useState(false)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [errors,  setErrors]  = useState<Record<string, string>>({})

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }))

  const validate = () => {
    const errs: Record<string, string> = {}
    if (!form.name.trim())     errs.name     = '請輸入姓名'
    if (!form.email.trim())    errs.email    = '請輸入電子郵件'
    if (form.password.length < 8) errs.password = '密碼至少 8 個字元'
    if (form.password !== form.confirm) errs.confirm = '兩次密碼不一致'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:    form.name.trim(),
          email:   form.email.trim(),
          password: form.password,
          orgName: form.orgName.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.message ?? '註冊失敗'); return }
      router.push('/dashboard')
      router.refresh()
    } catch {
      setError('網路錯誤，請稍後再試')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="姓名" type="text" value={form.name} onChange={set('name')}
        placeholder="王大明" icon={<User size={14} />} error={errors.name} required />

      <Input label="電子郵件" type="email" value={form.email} onChange={set('email')}
        placeholder="you@example.com" icon={<Mail size={14} />} error={errors.email} required />

      <Input label="公司 / 組織（選填）" type="text" value={form.orgName} onChange={set('orgName')}
        placeholder="My Company" icon={<Building2 size={14} />} />

      <div className="relative">
        <Input
          label="密碼" type={showPw ? 'text' : 'password'} value={form.password}
          onChange={set('password')} placeholder="至少 8 個字元"
          icon={<Lock size={14} />} error={errors.password} required
        />
        <button type="button" onClick={() => setShowPw((v) => !v)}
          className="absolute right-3 top-[38px] text-gray-400 hover:text-gray-600">
          {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>

      <Input label="確認密碼" type="password" value={form.confirm} onChange={set('confirm')}
        placeholder="再輸入一次密碼" icon={<Lock size={14} />} error={errors.confirm} required />

      {error && (
        <div className="px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <Button type="submit" variant="primary" fullWidth loading={loading} className="mt-2">
        建立帳號
      </Button>

      <p className="text-center text-sm text-gray-500">
        已有帳號？{' '}
        <Link href="/auth/login" className="text-brand-600 font-medium hover:text-brand-700">
          立即登入
        </Link>
      </p>
    </form>
  )
}
