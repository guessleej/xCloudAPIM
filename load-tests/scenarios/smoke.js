/**
 * Smoke Test — 1 VU, 2 minutes
 * 目的：確認所有服務基本可用，作為 CI gate
 */
import http from 'k6/http'
import { sleep } from 'k6'
import { checkStatus, checkGateway, checkGraphQL } from '../libs/checks.js'
import { authHeaders, apiKeyHeaders, GW_URL, AUTH_URL } from '../libs/auth.js'
import { listAPIs, gqlQuery, GQL_LIST_APIS } from '../libs/api.js'

const REGISTRY_URL = __ENV.REGISTRY_URL || 'http://localhost:8082'
const API_KEY      = __ENV.TEST_API_KEY  || ''
const TEST_PATH    = __ENV.TEST_PATH     || '/dev/echo/v1/anything'

export const options = {
  vus:      1,
  duration: '2m',
  thresholds: {
    http_req_failed:   ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
    custom_errors:     ['rate<0.01'],
  },
}

export default function () {
  // 1. Auth service healthcheck
  const health = http.get(`${AUTH_URL}/healthz`, { tags: { name: 'auth_health' } })
  checkStatus(health, 'auth_healthz')

  // 2. Registry — list APIs
  const h = authHeaders()
  const list = listAPIs(h)
  checkStatus(list, 'registry_list_apis')

  // 3. BFF GraphQL query
  const gql = gqlQuery(GQL_LIST_APIS, { page: 1, pageSize: 5 }, h)
  checkGraphQL(gql, 'bff_list_apis')

  // 4. Gateway proxy (with API key if provided)
  if (API_KEY) {
    const proxy = http.get(`${GW_URL}${TEST_PATH}`, {
      headers: apiKeyHeaders(API_KEY),
      tags: { name: 'gateway_proxy' },
    })
    checkGateway(proxy, 'gateway_proxy')
  }

  sleep(1)
}
