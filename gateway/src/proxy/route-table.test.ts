import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import {
  applyDeltaForTest,
  getRouteCount,
  matchRoute,
  replaceRoutesForTest,
  resetRoutesForTest,
} from './route-table.js'

describe('gateway route table', () => {
  beforeEach(() => {
    resetRoutesForTest()
  })

  it('keeps route sync entries distinct by api, host, prefix, method, and version', () => {
    applyDeltaForTest([
      route({ apiId: 'catalog', pathPrefix: '/v1/catalog', methods: ['GET'], version: 'v1' }),
      route({ apiId: 'catalog', pathPrefix: '/v2/catalog', methods: ['GET'], version: 'v2' }),
      route({ apiId: 'catalog', pathPrefix: '/v2/catalog', methods: ['POST'], version: 'v2' }),
    ])

    assert.equal(getRouteCount(), 3)

    applyDeltaForTest([
      route({
        apiId: 'catalog',
        pathPrefix: '/v1/catalog',
        methods: ['GET'],
        version: 'v1',
        upstreamUrl: 'http://catalog-v1-updated',
      }),
    ])

    assert.equal(getRouteCount(), 3)
    assert.equal(matchRoute('api.local', '/v1/catalog/items', 'GET')?.upstreamUrl, 'http://catalog-v1-updated')
    assert.equal(matchRoute('api.local', '/v2/catalog/items', 'GET')?.upstreamUrl, 'http://upstream.local')
    assert.equal(matchRoute('api.local', '/v2/catalog/items', 'POST')?.upstreamUrl, 'http://upstream.local')
  })

  it('uses longest-prefix matching without crossing path segment boundaries', () => {
    replaceRoutesForTest([
      route({ apiId: 'root', pathPrefix: '/api' }),
      route({ apiId: 'users', pathPrefix: '/api/users' }),
    ])

    assert.equal(matchRoute('api.local', '/api/users/123', 'GET')?.apiId, 'users')
    assert.equal(matchRoute('api.local', '/apiary/users', 'GET'), null)
  })

  it('prefers host-specific and method-specific routes over wildcard routes', () => {
    replaceRoutesForTest([
      route({ apiId: 'wildcard', host: null, pathPrefix: '/api' }),
      route({ apiId: 'hosted', host: 'portal.apim.local', pathPrefix: '/api' }),
      route({ apiId: 'hosted-post', host: 'portal.apim.local', pathPrefix: '/api', methods: ['POST'] }),
    ])

    assert.equal(matchRoute('portal.apim.local:19000', '/api/resource', 'GET')?.apiId, 'hosted')
    assert.equal(matchRoute('portal.apim.local:19000', '/api/resource', 'POST')?.apiId, 'hosted-post')
    assert.equal(matchRoute('other.local', '/api/resource', 'GET')?.apiId, 'wildcard')
  })
})

function route(overrides: {
  apiId: string
  pathPrefix: string
  host?: string | null
  methods?: string[]
  version?: string
  upstreamUrl?: string
}) {
  return {
    apiId: overrides.apiId,
    upstreamUrl: overrides.upstreamUrl ?? 'http://upstream.local',
    stripPrefix: '',
    active: true,
    version: overrides.version ?? 'v1',
    host: overrides.host === undefined ? 'api.local' : overrides.host,
    pathPrefix: overrides.pathPrefix,
    methods: overrides.methods ?? [],
  }
}
