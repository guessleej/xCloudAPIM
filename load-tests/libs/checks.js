import { check, fail } from 'k6'
import { Rate, Trend, Counter } from 'k6/metrics'

export const errorRate     = new Rate('custom_errors')
export const gatewayP99    = new Trend('gateway_p99_ms',    true)
export const authP99       = new Trend('auth_p99_ms',       true)
export const registryP99   = new Trend('registry_p99_ms',   true)
export const totalRequests = new Counter('total_requests')

export function checkStatus(res, name, expectedStatus = 200) {
  totalRequests.add(1)
  const ok = check(res, {
    [`${name} status ${expectedStatus}`]: (r) => r.status === expectedStatus,
    [`${name} duration < 2s`]:            (r) => r.timings.duration < 2000,
  })
  if (!ok) errorRate.add(1)
  return ok
}

export function checkGateway(res, name = 'gateway') {
  totalRequests.add(1)
  const ok = check(res, {
    [`${name} not 5xx`]:     (r) => r.status < 500,
    [`${name} not 401/403`]: (r) => r.status !== 401 && r.status !== 403,
    [`${name} < 500ms`]:     (r) => r.timings.duration < 500,
  })
  gatewayP99.add(res.timings.duration)
  if (!ok) errorRate.add(1)
  return ok
}

export function checkGraphQL(res, operationName) {
  totalRequests.add(1)
  const ok = check(res, {
    [`${operationName} status 200`]:   (r) => r.status === 200,
    [`${operationName} no gql errors`]: (r) => {
      try { return !r.json('errors') } catch { return false }
    },
    [`${operationName} < 1s`]:         (r) => r.timings.duration < 1000,
  })
  if (!ok) errorRate.add(1)
  return ok
}
