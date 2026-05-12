import assert from 'node:assert/strict'
import test from 'node:test'

const REGISTRY_URL = process.env.REGISTRY_URL ?? 'http://localhost:18082'
const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:18090'
const SEED_ROUTE_PREFIX = process.env.SEED_ROUTE_PREFIX ?? '/dev/echo/v1'

test('gateway route sync observes registry route delta', async () => {
  const registry = await fetch(`${REGISTRY_URL}/internal/routes/delta?since=0`)
  if (registry.status !== 200) {
    assert.fail(`unexpected registry status ${registry.status}: ${await registry.text()}`)
  }

  const registryBody = await registry.json()
  const seedRoute = registryBody.routes.find((route) => route.path_prefix === SEED_ROUTE_PREFIX)
  assert.ok(seedRoute, `registry delta must include ${SEED_ROUTE_PREFIX}`)

  const gatewayHealth = await waitForGatewayRoutes()
  assert.ok(gatewayHealth.routes > 0, 'gateway should have synced at least one active route')
})

async function waitForGatewayRoutes() {
  let lastBody = null

  for (let attempt = 0; attempt < 15; attempt += 1) {
    const res = await fetch(`${GATEWAY_URL}/healthz`)
    if (res.status !== 200) {
      assert.fail(`unexpected gateway status ${res.status}: ${await res.text()}`)
    }

    lastBody = await res.json()
    if (Number(lastBody.routes) > 0) return lastBody

    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  return lastBody ?? { routes: 0 }
}
