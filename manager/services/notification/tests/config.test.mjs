import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('notification config does not carry development secret fallbacks', async () => {
  const config = await readFile(new URL('../src/config/index.ts', import.meta.url), 'utf8')

  const forbiddenSecretFallbacks = new RegExp(['mongo_pass', 'redis_pass'].map((prefix) => `${prefix}_dev`).join('|'))
  assert.doesNotMatch(config, forbiddenSecretFallbacks)
  assert.match(config, /MONGO_URI:\s*z\.string\(\)\.url\(\)/)
  assert.match(config, /REDIS_PASSWORD:\s*z\.string\(\)\.default\(''\)/)
})
