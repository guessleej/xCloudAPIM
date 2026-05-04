import { NextResponse, type NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

const PROTECTED = ['/dashboard']
const AUTH_PATHS = ['/auth/login', '/auth/register']
const COOKIE_NAME = 'apim_session'

function getSecret() {
  const s = process.env.SESSION_SECRET ?? ''
  return new TextEncoder().encode(s)
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isProtected = PROTECTED.some((p) => pathname.startsWith(p))
  const isAuthPath   = AUTH_PATHS.some((p) => pathname.startsWith(p))

  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value

  let isAuthenticated = false
  if (sessionCookie) {
    try {
      await jwtVerify(sessionCookie, getSecret())
      isAuthenticated = true
    } catch {
      // expired or invalid
    }
  }

  // Redirect unauthenticated users away from protected routes
  if (isProtected && !isAuthenticated) {
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Redirect already-authenticated users away from auth pages
  if (isAuthPath && isAuthenticated) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/auth/:path*'],
}
