import assert from 'node:assert/strict'
import test from 'node:test'

const BFF_URL = process.env.BFF_URL ?? 'http://localhost:14000/graphql'

test('bff graphql schema accepts a resolver smoke query', async () => {
  const res = await fetch(BFF_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'query ResolverSmoke { __typename }' }),
  })

  if (res.status !== 200) {
    assert.fail(`unexpected BFF status ${res.status}: ${await res.text()}`)
  }

  const body = await res.json()
  assert.deepEqual(body.errors ?? [], [])
  assert.equal(body.data.__typename, 'Query')
})
