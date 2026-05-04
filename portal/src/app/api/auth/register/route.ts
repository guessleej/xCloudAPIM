import { NextRequest, NextResponse } from 'next/server'
import { ApolloClient, InMemoryCache, HttpLink } from '@apollo/client'
import { createSession, setSessionCookie } from '@/lib/auth'
import { REGISTER } from '@/lib/graphql/mutations'

const bffClient = new ApolloClient({
  cache: new InMemoryCache(),
  link:  new HttpLink({ uri: process.env.BFF_URL ?? 'http://localhost:4000/graphql' }),
  ssrMode: true,
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { name, email, password, orgName } = body

  if (!name || !email || !password) {
    return NextResponse.json({ message: '請填寫所有必填欄位' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ message: '密碼至少 8 個字元' }, { status: 400 })
  }

  try {
    const { data, errors } = await bffClient.mutate({
      mutation:  REGISTER,
      variables: { input: { name, email, password, orgName } },
    })

    if (errors?.length) {
      return NextResponse.json({ message: errors[0].message }, { status: 422 })
    }

    const { token, user } = data.register
    const sessionJwt = await createSession({
      sub:   user.id,
      email: user.email,
      name:  user.name,
      orgId: '',
      role:  user.role,
      token,
    })

    await setSessionCookie(sessionJwt)
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '註冊失敗'
    return NextResponse.json({ message: msg }, { status: 422 })
  }
}
