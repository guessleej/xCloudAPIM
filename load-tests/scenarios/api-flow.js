/**
 * API Flow Test — 端對端使用者旅程
 * 模擬真實開發者完整操作流程：
 *   Register → Login → Browse APIs → Subscribe → Create API Key → Call API
 */
import http from 'k6/http'
import { sleep, group, check, fail } from 'k6'
import { checkStatus, checkGateway } from '../libs/checks.js'
import { GW_URL, AUTH_URL } from '../libs/auth.js'

const REGISTRY_URL     = __ENV.REGISTRY_URL     || 'http://localhost:8082'
const SUBSCRIPTION_URL = __ENV.SUBSCRIPTION_URL || 'http://localhost:8084'
const BFF_URL          = __ENV.BFF_URL          || 'http://localhost:4000'
const TEST_PATH        = __ENV.TEST_PATH        || '/petstore/v1/pets'

export const options = {
  scenarios: {
    api_flow: {
      executor:        'per-vu-iterations',
      vus:             10,
      iterations:      5,
      maxDuration:     '10m',
    },
  },
  thresholds: {
    http_req_failed:   ['rate<0.05'],
    http_req_duration: ['p(95)<3000'],
  },
}

export default function () {
  const uid  = `k6-${__VU}-${__ITER}-${Date.now()}`
  const email = `${uid}@test.example.com`
  let token = null
  let apiKey = null

  // ── Step 1: Register
  group('1. Register', () => {
    const res = http.post(
      `${AUTH_URL}/api/v1/auth/register`,
      JSON.stringify({ email, password: 'P@ssword123!', name: uid, organizationName: `Org-${uid}` }),
      { headers: { 'Content-Type': 'application/json' }, tags: { name: 'flow_register' } },
    )
    checkStatus(res, 'register', 201)
  })

  sleep(0.5)

  // ── Step 2: Login
  group('2. Login', () => {
    const res = http.post(
      `${AUTH_URL}/api/v1/auth/login`,
      JSON.stringify({ email, password: 'P@ssword123!' }),
      { headers: { 'Content-Type': 'application/json' }, tags: { name: 'flow_login' } },
    )
    if (!checkStatus(res, 'login')) return
    token = res.json('data.accessToken')
  })

  if (!token) return

  const authH = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${token}`,
  }

  sleep(0.3)

  // ── Step 3: Browse APIs via BFF
  group('3. Browse APIs', () => {
    const res = http.post(
      `${BFF_URL}/graphql`,
      JSON.stringify({
        query: 'query{apis(page:1,pageSize:5){nodes{id name status}total}}',
      }),
      { headers: authH, tags: { name: 'flow_browse_apis' } },
    )
    check(res, { 'browse_apis 200': (r) => r.status === 200 && !r.json('errors') })
  })

  sleep(0.5)

  // ── Step 4: Get first available API
  let planId = null
  group('4. Get Plan', () => {
    const listRes = http.get(
      `${REGISTRY_URL}/api/v1/apis?page=1&pageSize=1&status=ACTIVE`,
      { headers: authH, tags: { name: 'flow_get_api' } },
    )
    if (listRes.status !== 200) return
    const apis = listRes.json('data.nodes')
    if (!apis || !apis.length) return

    const apiId = apis[0].id
    const planRes = http.get(
      `${SUBSCRIPTION_URL}/api/v1/apis/${apiId}/plans`,
      { tags: { name: 'flow_list_plans' } },
    )
    if (planRes.status !== 200) return
    const plans = planRes.json('data')
    if (!plans || !plans.length) return
    planId = plans[0].id
  })

  if (!planId) { sleep(1); return }

  sleep(0.3)

  // ── Step 5: Subscribe
  let subId = null
  group('5. Subscribe', () => {
    const res = http.post(
      `${SUBSCRIPTION_URL}/api/v1/subscriptions`,
      JSON.stringify({ planId }),
      { headers: authH, tags: { name: 'flow_subscribe' } },
    )
    if (!check(res, { 'subscribe 201': (r) => r.status === 201 })) return
    subId = res.json('data.id')
  })

  if (!subId) { sleep(1); return }

  sleep(0.3)

  // ── Step 6: Create API Key
  group('6. Create API Key', () => {
    const res = http.post(
      `${SUBSCRIPTION_URL}/api/v1/subscriptions/${subId}/keys`,
      JSON.stringify({ name: `${uid}-key` }),
      { headers: authH, tags: { name: 'flow_create_key' } },
    )
    if (!check(res, { 'create_key 201': (r) => r.status === 201 })) return
    apiKey = res.json('data.key')
  })

  if (!apiKey) { sleep(1); return }

  sleep(0.5)

  // ── Step 7: Call API via Gateway
  group('7. Call Gateway', () => {
    const res = http.get(`${GW_URL}${TEST_PATH}`, {
      headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' },
      tags: { name: 'flow_gateway_call' },
    })
    checkGateway(res, 'flow_gateway')
  })

  sleep(1)
}
