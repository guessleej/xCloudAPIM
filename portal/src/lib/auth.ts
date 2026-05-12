/**
 * JWT session stored in httpOnly cookie "apim_session"
 */
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

const COOKIE_NAME  = 'apim_session'
const COOKIE_MAX_S = 60 * 60 * 24 * 7  // 7 days

function getSecret() {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters')
  }
  return new TextEncoder().encode(secret)
}

export interface SessionUser {
  sub:      string   // user id
  email:    string
  name:     string
  orgId:    string
  role:     string
  token:    string   // upstream JWT (passed to BFF as Authorization)
}

export async function createSession(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecret())
}

export async function getSession(): Promise<SessionUser | null> {
  const jar   = await cookies()
  const token = jar.get(COOKIE_NAME)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecret())
    return payload as unknown as SessionUser
  } catch {
    return null
  }
}

export async function setSessionCookie(jwt: string): Promise<void> {
  const jar = await cookies()
  jar.set(COOKIE_NAME, jwt, {
    httpOnly: true,
    secure:   process.env.SESSION_COOKIE_SECURE === 'true',
    sameSite: 'lax',
    maxAge:   COOKIE_MAX_S,
    path:     '/',
  })
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies()
  jar.delete(COOKIE_NAME)
}
