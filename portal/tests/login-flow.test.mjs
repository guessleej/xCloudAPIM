import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const source = readFileSync(new URL('../src/components/auth/LoginForm.tsx', import.meta.url), 'utf8')

describe('portal login flow contract', () => {
  it('posts credentials to the local auth API route', () => {
    assert.match(source, /fetch\('\/api\/auth\/login'/)
    assert.match(source, /method:\s+'POST'/)
    assert.match(source, /JSON\.stringify\(\{\s*email,\s*password\s*\}\)/s)
  })

  it('redirects to next query param or dashboard after successful login', () => {
    assert.match(source, /params\.get\('next'\)\s+\?\?\s+'\/dashboard'/)
    assert.match(source, /router\.push\(next\)/)
    assert.match(source, /router\.refresh\(\)/)
  })
})
