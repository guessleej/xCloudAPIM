import { gql } from '@apollo/client'

// ── Public ───────────────────────────────────────────────────

export const GET_PUBLIC_APIS = gql`
  query GetPublicAPIs($limit: Int, $page: Int) {
    apis(limit: $limit, page: $page) {
      nodes {
        id name version basePath description status tags
        org { id name }
      }
      pageInfo { page limit total totalPages hasNext }
    }
  }
`

export const GET_API_DETAIL = gql`
  query GetAPIDetail($id: ID!) {
    api(id: $id) {
      id name version basePath upstreamUrl description status tags
      org { id name }
    }
    plans(isPublic: true) {
      id name description rpmLimit rphLimit rpdLimit maxKeys price currency isPublic
    }
  }
`

export const GET_API_FOR_DOCS = gql`
  query GetAPIForDocs($id: ID!) {
    api(id: $id) {
      id name version basePath upstreamUrl description status tags
      org { id name }
      policyChain {
        policies {
          type enabled config
        }
      }
    }
  }
`

// ── Authenticated ────────────────────────────────────────────

export const GET_ME = gql`
  query GetMe {
    me {
      id email name role
      org { id name }
    }
  }
`

export const GET_MY_SUBSCRIPTIONS = gql`
  query GetMySubscriptions {
    subscriptions {
      nodes {
        id status createdAt
        plan { id name }
        api { id name basePath version }
        apiKeys { id name keyPrefix status createdAt lastUsedAt subscriptionId }
      }
    }
  }
`

export const GET_SUBSCRIPTION_DETAIL = gql`
  query GetSubscriptionDetail($id: ID!) {
    subscription(id: $id) {
      id status createdAt updatedAt
      plan {
        id name description rpmLimit rphLimit rpdLimit
      }
      api { id name basePath version description }
      apiKeys { id name keyPrefix plainKey status createdAt lastUsedAt subscriptionId }
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
