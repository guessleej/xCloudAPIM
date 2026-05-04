/**
 * Stress Test — 找出系統破壞點
 * 目的：持續增加負載，找到錯誤率開始上升的臨界點
 * 注意：此測試會讓系統承受超出設計容量的負載，執行前需確認不影響生產
 */
import http from 'k6/http'
import { sleep } from 'k6'
import { checkGateway, checkStatus, errorRate } from '../libs/checks.js'
import { authHeaders, apiKeyHeaders, GW_URL } from '../libs/auth.js'

const API_KEY   = __ENV.TEST_API_KEY || ''
const TEST_PATH = __ENV.TEST_PATH    || '/petstore/v1/pets'
const REGISTRY  = __ENV.REGISTRY_URL || 'http://localhost:8082'

export const options = {
  stages: [
    { duration: '2m',  target: 50  },   // warm-up
    { duration: '5m',  target: 100 },   // load
    { duration: '2m',  target: 200 },   // high load
    { duration: '5m',  target: 200 },   // sustain
    { duration: '2m',  target: 300 },   // stress
    { duration: '5m',  target: 300 },   // break point
    { duration: '2m',  target: 400 },   // beyond break point
    { duration: '5m',  target: 400 },
    { duration: '5m',  target: 0   },   // recovery
  ],
  thresholds: {
    // Softer thresholds — we expect degradation; we're looking for the cliff
    http_req_failed:   ['rate<0.15'],
    http_req_duration: ['p(99)<5000'],
    custom_errors:     ['rate<0.15'],
  },
}

export function setup() {
  console.log('Stress test starting — gateway:', GW_URL)
  console.log('This test will push the system beyond capacity.')
  console.log('Watch Grafana for the error rate cliff.')
}

export default function () {
  const r = Math.random()

  if (r < 0.7) {
    // Gateway — largest share, simulates real traffic
    const headers = API_KEY
      ? apiKeyHeaders(API_KEY)
      : { Authorization: `Bearer ${authHeaders()['Authorization']}` }
    const res = http.get(`${GW_URL}${TEST_PATH}`, {
      headers,
      tags: { name: 'stress_gateway' },
    })
    checkGateway(res, 'stress_gateway')
  } else if (r < 0.85) {
    // Registry reads
    const res = http.get(
      `${REGISTRY}/api/v1/apis?page=1&pageSize=20`,
      { headers: authHeaders(), tags: { name: 'stress_registry' } },
    )
    checkStatus(res, 'stress_registry')
  } else {
    // Auth login burst (simulates credential stuffing scenario)
    const res = http.post(
      `${__ENV.AUTH_URL || 'http://localhost:8081'}/api/v1/auth/login`,
      JSON.stringify({ email: 'load@example.com', password: 'P@ssword123!' }),
      { headers: { 'Content-Type': 'application/json' }, tags: { name: 'stress_auth' } },
    )
    checkStatus(res, 'stress_auth')
  }

  sleep(Math.random() * 0.5) // minimal think time to maximize RPS
}

export function teardown(data) {
  console.log('Stress test complete. Check Grafana dashboard for results.')
}
