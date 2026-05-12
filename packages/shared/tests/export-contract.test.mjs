import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

test('shared package keeps source and package export contract aligned', async () => {
  await access(new URL('../types/index.ts', import.meta.url))
  await access(new URL('../utils/index.ts', import.meta.url))

  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  )

  assert.equal(packageJson.exports['./types'], './dist/types/index.js')
  assert.equal(packageJson.exports['./utils'], './dist/utils/index.js')
})
