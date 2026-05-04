import { NextRequest, NextResponse } from 'next/server'
import { ApolloClient, InMemoryCache, HttpLink } from '@apollo/client'
import { createSession, setSessionCookie } from '@/lib/auth'
import { LOGIN } from '@/lib/graphql/mutations'

const bffClient = new ApolloClient({
  cache: new InMemoryCache(),
  link:  new HttpLink({ uri: process.env.BFF_URL ?? 'http://localhost:4000/graphql' }),
  ssrMode: true,
})

export async function POST(req: NextRequest) {
  const { email, password } = await req.json().catch(() => ({}))

  if (!email || !password) {
    return NextResponse.json({ message: '請填寫電子郵件與密碼' }, { status: 400 })
  }

  try {
    const { data, errors } = await bffClient.mutate({
      mutation:  LOGIN,
      variables: { email, password },
    })

    if (errors?.length) {
      return NextResponse.json({ message: errors[0].message }, { status: 401 })
    }

    const { token, user } = data.login
    const sessionJwt = await createSession({
      sub:   user.id,
      email: user.email,
      name:  user.name,
      orgId: user.organizations?.[0]?.id ?? '',
      role:  user.role,
      token,
    })

    await setSessionCookie(sessionJwt)
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '登入失敗'
    return NextResponse.json({ message: msg }, { status: 401 })
  }
}
