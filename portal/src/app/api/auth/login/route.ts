import { NextRequest, NextResponse } from 'next/server'
import { createSession, setSessionCookie } from '@/lib/auth'

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL ?? 'http://localhost:8081'

interface AuthLoginResponse {
  session_token: string
  user: {
    id:           string
    email:        string
    display_name: string
    org_id:       string
    org_name:     string
    role:         string
  }
}

export async function POST(req: NextRequest) {
  const { email, password } = await req.json().catch(() => ({}))

  if (!email || !password) {
    return NextResponse.json({ message: '請填寫電子郵件與密碼' }, { status: 400 })
  }

  try {
    const res = await fetch(`${AUTH_SERVICE_URL}/auth/login`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ email, password }),
      cache:   'no-store',
    })

    const data = await res.json().catch(() => ({})) as Partial<AuthLoginResponse> & { error?: string; message?: string }
    if (!res.ok || !data.session_token || !data.user) {
      return NextResponse.json({ message: data.message ?? data.error ?? '登入失敗' }, { status: res.status || 401 })
    }

    const sessionJwt = await createSession({
      sub:   data.user.id,
      email: data.user.email,
      name:  data.user.display_name || data.user.email,
      orgId: data.user.org_id ?? '',
      role:  data.user.role,
      token: data.session_token,
    })

    await setSessionCookie(sessionJwt)
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '登入失敗'
    return NextResponse.json({ message: msg }, { status: 401 })
  }
}
