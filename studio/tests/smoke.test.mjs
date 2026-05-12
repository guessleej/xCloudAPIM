import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

test('studio has the core Vite entrypoints wired', async () => {
  await access(new URL('../src/main.tsx', import.meta.url))
  await access(new URL('../src/App.tsx', import.meta.url))

  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  )

  assert.equal(packageJson.scripts.typecheck, 'tsc --noEmit')
  assert.match(packageJson.scripts.build, /vite build/)
})
