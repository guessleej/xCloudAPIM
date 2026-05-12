/**
 * Load Test — 正常流量模擬
 * 目的：驗證在預期負載下的 P95/P99 延遲與錯誤率
 *
 * 場景分佈：
 *   60% — Gateway proxy（最熱路徑）
 *   25% — Registry / BFF 讀取
 *   15% — Auth（token 刷新、login）
 */
import http from 'k6/http'
import { sleep } from 'k6'
import exec from 'k6/execution'
import { checkStatus, checkGateway, checkGraphQL, gatewayP99, registryP99 } from '../libs/checks.js'
import { authHeaders, apiKeyHeaders, GW_URL, AUTH_URL } from '../libs/auth.js'
import { listAPIs, getAPI, gqlQuery, GQL_LIST_APIS, GQL_DASHBOARD } from '../libs/api.js'

const REGISTRY_URL = __ENV.REGISTRY_URL || 'http://localhost:8082'
const API_KEY      = __ENV.TEST_API_KEY  || ''
const TEST_PATH    = __ENV.TEST_PATH     || '/dev/echo/v1/anything'
const TARGET_API   = __ENV.TARGET_API_ID || ''

export const options = {
  stages: [
    { duration: '1m',  target: 20  },  // ramp-up
    { duration: '3m',  target: 50  },  // steady state
    { duration: '1m',  target: 100 },  // peak
    { duration: '3m',  target: 100 },  // sustain peak
    { duration: '1m',  target: 0   },  // ramp-down
  ],
  thresholds: {
    http_req_failed:               ['rate<0.01'],
    'http_req_duration{name:gateway_proxy}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{name:registry_list_apis}': ['p(95)<800'],
    'http_req_duration{name:bff_gql}':       ['p(95)<1000'],
    custom_errors:                 ['rate<0.02'],
  },
}

export default function () {
  const vu = exec.vu.idInTest
  const r  = Math.random()

  if (r < 0.60) {
    // ── Gateway proxy path (hot path)
    const headers = API_KEY
      ? apiKeyHeaders(API_KEY)
      : { 'Authorization': `Bearer ${authHeaders()['Authorization']}` }
    const res = http.get(`${GW_URL}${TEST_PATH}`, {
      headers,
      tags: { name: 'gateway_proxy' },
    })
    checkGateway(res, 'gateway_proxy')
    gatewayP99.add(res.timings.duration)

  } else if (r < 0.85) {
    // ── Registry / BFF reads
    const h = authHeaders()
    if (r < 0.70) {
      const res = listAPIs(h)
      checkStatus(res, 'registry_list_apis')
      registryP99.add(res.timings.duration)
    } else if (TARGET_API) {
      const res = getAPI(TARGET_API, h)
      checkStatus(res, 'registry_get_api')
    } else {
      const res = gqlQuery(GQL_LIST_APIS, { page: 1, pageSize: 10 }, h)
      checkGraphQL(res, 'bff_list_apis')
    }

  } else {
    // ── BFF dashboard (heavier aggregation query)
    const res = gqlQuery(GQL_DASHBOARD, {}, authHeaders())
    checkGraphQL(res, 'bff_dashboard')
  }

  sleep(Math.random() * 1 + 0.2) // 0.2–1.2s think time
}
