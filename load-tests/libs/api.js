import http from 'k6/http'

const REGISTRY_URL     = __ENV.REGISTRY_URL     || 'http://localhost:8082'
const SUBSCRIPTION_URL = __ENV.SUBSCRIPTION_URL || 'http://localhost:8084'
const BFF_URL          = __ENV.BFF_URL          || 'http://localhost:4000'

export function listAPIs(headers) {
  return http.get(`${REGISTRY_URL}/api/v1/apis?page=1&pageSize=20`, {
    headers,
    tags: { name: 'registry_list_apis' },
  })
}

export function getAPI(apiId, headers) {
  return http.get(`${REGISTRY_URL}/api/v1/apis/${apiId}`, {
    headers,
    tags: { name: 'registry_get_api' },
  })
}

export function getSpec(apiId) {
  return http.get(`${REGISTRY_URL}/apis/${apiId}/spec`, {
    tags: { name: 'registry_get_spec' },
  })
}

export function listPlans(apiId) {
  return http.get(`${SUBSCRIPTION_URL}/api/v1/apis/${apiId}/plans`, {
    tags: { name: 'sub_list_plans' },
  })
}

export function gqlQuery(query, variables, headers) {
  return http.post(
    `${BFF_URL}/graphql`,
    JSON.stringify({ query, variables }),
    { headers: { 'Content-Type': 'application/json', ...headers }, tags: { name: 'bff_gql' } },
  )
}

export const GQL_LIST_APIS = `
  query GetAPIs($page: Int, $pageSize: Int) {
    apis(page: $page, pageSize: $pageSize) {
      nodes { id name status chainId }
      total
    }
  }
`

export const GQL_DASHBOARD = `
  query {
    dashboardStats {
      totalAPIs activeAPIs totalSubscriptions requestsToday errorsToday p99LatencyMs
    }
  }
`

export { REGISTRY_URL, SUBSCRIPTION_URL, BFF_URL }
