/**
 * Soak Test — 長時間耐久測試
 * 目的：偵測記憶體洩漏、連線池耗盡、定時任務累積等問題
 * 預設執行 2 小時（CI 短跑可用 DURATION=30m 覆蓋）
 */
import http from 'k6/http'
import { sleep, check } from 'k6'
import { checkGateway, checkStatus, checkGraphQL } from '../libs/checks.js'
import { authHeaders, apiKeyHeaders, GW_URL, AUTH_URL } from '../libs/auth.js'
import { listAPIs, gqlQuery, GQL_LIST_APIS } from '../libs/api.js'

const DURATION  = __ENV.DURATION     || '2h'
const API_KEY   = __ENV.TEST_API_KEY || ''
const TEST_PATH = __ENV.TEST_PATH    || '/petstore/v1/pets'

export const options = {
  stages: [
    { duration: '5m',                  target: 20 },  // ramp-up
    { duration: DURATION,              target: 20 },  // sustained load
    { duration: '5m',                  target: 0  },  // ramp-down
  ],
  thresholds: {
    // Soak must maintain same quality as steady-state load
    http_req_failed:   ['rate<0.01'],
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    custom_errors:     ['rate<0.01'],

    // Memory leak signal: p99 should not drift more than 2x between start/end
    // (manual inspection via Grafana trend)
    'http_req_duration{name:gateway_proxy}': ['p(95)<500'],
  },
}

let iteration = 0

export default function () {
  iteration++
  const r = Math.random()

  if (r < 0.65) {
    // Sustained gateway traffic
    const headers = API_KEY
      ? apiKeyHeaders(API_KEY)
      : { Authorization: `Bearer ${authHeaders()['Authorization']}` }
    const res = http.get(`${GW_URL}${TEST_PATH}`, {
      headers,
      tags: { name: 'gateway_proxy' },
    })
    checkGateway(res, 'gateway_proxy')
  } else if (r < 0.85) {
    // Registry reads
    const res = listAPIs(authHeaders())
    checkStatus(res, 'registry_list_apis')
  } else {
    // BFF GraphQL — ensures no session/connection leak
    const res = gqlQuery(GQL_LIST_APIS, { page: 1, pageSize: 5 }, authHeaders())
    checkGraphQL(res, 'bff_list_apis')
  }

  // Periodically log progress
  if (iteration % 500 === 0) {
    console.log(`Soak iteration ${iteration} — still running`)
  }

  sleep(1 + Math.random() * 2) // 1–3s think time, realistic user pacing
}
