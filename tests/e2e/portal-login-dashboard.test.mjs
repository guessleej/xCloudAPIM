import assert from 'node:assert/strict'
import test from 'node:test'

const PORTAL_URL = process.env.PORTAL_URL ?? 'http://localhost:19000'
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL ?? 'codex-dev@apim.local'
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD ?? 'P@ssword123!'

test('portal login redirects authenticated user into dashboard', async () => {
  const login = await fetch(`${PORTAL_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD }),
  })

  if (login.status !== 200) {
    assert.fail(`unexpected portal login status ${login.status}: ${await login.text()}`)
  }

  const cookie = login.headers.get('set-cookie')
  assert.ok(cookie, 'portal login must set a session cookie')

  const dashboard = await fetch(`${PORTAL_URL}/dashboard`, {
    headers: { cookie },
    redirect: 'manual',
  })

  assert.notEqual(dashboard.status, 404)
  assert.doesNotMatch(dashboard.headers.get('location') ?? '', /\/auth\/login/)
  assert.ok([200, 307, 308].includes(dashboard.status), `unexpected dashboard status: ${dashboard.status}`)
})
