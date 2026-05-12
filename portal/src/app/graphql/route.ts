import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const BFF_URL = process.env.BFF_URL ?? 'http://localhost:4000/graphql'
const COOKIE_NAME = 'apim_session'

function getSecret() {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters')
  }
  return new TextEncoder().encode(secret)
}

async function getBearerToken(req: NextRequest): Promise<string | null> {
  const session = req.cookies.get(COOKIE_NAME)?.value
  if (!session) return null
  try {
    const { payload } = await jwtVerify(session, getSecret())
    return typeof payload['token'] === 'string' ? payload['token'] : null
  } catch {
    return null
  }
}

async function proxyGraphQL(req: NextRequest) {
  const headers = new Headers(req.headers)
  headers.set('host', new URL(BFF_URL).host)
  if (!headers.has('authorization')) {
    const token = await getBearerToken(req)
    if (token) headers.set('authorization', `Bearer ${token}`)
  }

  const upstream = await fetch(BFF_URL, {
    method:  req.method,
    headers,
    body:    req.method === 'GET' ? undefined : await req.text(),
    cache:   'no-store',
  })

  return new NextResponse(upstream.body, {
    status:     upstream.status,
    statusText: upstream.statusText,
    headers:    upstream.headers,
  })
}

export async function GET(req: NextRequest) {
  return proxyGraphQL(req)
}

export async function POST(req: NextRequest) {
  return proxyGraphQL(req)
}
