import { gql } from '@apollo/client'

// ── Public ───────────────────────────────────────────────────

export const GET_PUBLIC_APIS = gql`
  query GetPublicAPIs($limit: Int, $page: Int, $filter: APIFilter) {
    apis(limit: $limit, page: $page, filter: $filter) {
      nodes {
        id name version basePath description status tags
        organization { id name }
      }
      pageInfo { page limit total totalPages hasNext }
    }
  }
`

export const GET_API_DETAIL = gql`
  query GetAPIDetail($id: ID!) {
    api(id: $id) {
      id name version basePath upstreamUrl description status tags
      organization { id name }
      plans {
        id name description rateLimit { rpm rph rpd }
        quotaLimit { daily monthly } price isFree
      }
    }
  }
`

export const GET_API_FOR_DOCS = gql`
  query GetAPIForDocs($id: ID!) {
    api(id: $id) {
      id name version basePath upstreamUrl description status tags
      organization { id name }
      policyChain {
        policies {
          type enabled config
        }
      }
      plans {
        id name description isFree
        rateLimit { rpm rph rpd }
        quotaLimit { daily monthly }
      }
    }
  }
`

// ── Authenticated ────────────────────────────────────────────

export const GET_ME = gql`
  query GetMe {
    me {
      id email name role
      organizations { id name }
    }
  }
`

export const GET_MY_SUBSCRIPTIONS = gql`
  query GetMySubscriptions {
    subscriptions(filter: { mine: true }) {
      nodes {
        id status appName createdAt
        plan {
          id name
          api { id name basePath version }
        }
        apiKeys { id name keyPrefix status createdAt lastUsedAt }
      }
    }
  }
`

export const GET_SUBSCRIPTION_DETAIL = gql`
  query GetSubscriptionDetail($id: ID!) {
    subscription(id: $id) {
      id status appName createdAt updatedAt
      plan {
        id name description
        rateLimit { rpm rph rpd }
        quotaLimit { daily monthly }
        api { id name basePath version description }
      }
      apiKeys { id name keyPrefix status createdAt lastUsedAt }
    }
  }
`

export const GET_USAGE_STATS = gql`
  query GetUsageStats($apiId: ID!, $from: String!, $to: String!) {
    usageStats(apiId: $apiId, from: $from, to: $to) {
      totalRequests successRequests errorRequests
      avgLatencyMs p99LatencyMs
      dailySeries {
        date requests errors avgLatency
      }
    }
  }
`
