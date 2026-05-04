import http from 'k6/http'
import { check } from 'k6'

const AUTH_URL = __ENV.AUTH_URL || 'http://localhost:8081'
const GW_URL   = __ENV.GW_URL   || 'http://localhost:8090'

// Token cache — reused across iterations within same VU
let _token      = null
let _tokenExpiry = 0

export function getToken(email = 'load@example.com', password = 'P@ssword123!') {
  const now = Date.now()
  if (_token && now < _tokenExpiry) return _token

  const res = http.post(
    `${AUTH_URL}/api/v1/auth/login`,
    JSON.stringify({ email, password }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'auth_login' } },
  )

  check(res, { 'login 200': (r) => r.status === 200 })

  if (res.status === 200) {
    const body = res.json()
    _token      = body.data.accessToken
    _tokenExpiry = now + 13 * 60 * 1000 // refresh 2 min before 15m expiry
  }
  return _token
}

export function authHeaders(extraHeaders = {}) {
  return {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${getToken()}`,
    ...extraHeaders,
  }
}

export function apiKeyHeaders(apiKey, extraHeaders = {}) {
  return {
    'Accept':    'application/json',
    'X-API-Key': apiKey || __ENV.TEST_API_KEY || 'test-api-key',
    ...extraHeaders,
  }
}

export { GW_URL, AUTH_URL }
