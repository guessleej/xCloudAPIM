import { gql } from '@apollo/client'

export const POLICY_CHAIN_FRAGMENT = gql`
  fragment PolicyChainFields on PolicyChain {
    chainId
    apiId
    version
    etag
    updatedAt
    policies {
      id
      type
      phase
      order
      enabled
      config
      condition
    }
  }
`

export const GET_APIS = gql`
  query GetAPIs($page: Int, $limit: Int) {
    apis(page: $page, limit: $limit) {
      nodes {
        id
        name
        version
        basePath
        upstreamUrl
        status
        orgId
        tags
        policyChain { chainId version updatedAt policies { id type } }
      }
      pageInfo { page limit total totalPages hasNext }
    }
  }
`

export const GET_API_WITH_CHAIN = gql`
  ${POLICY_CHAIN_FRAGMENT}
  query GetAPIWithChain($id: ID!) {
    api(id: $id) {
      id
      name
      version
      basePath
      upstreamUrl
      description
      status
      orgId
      tags
      policyChain { ...PolicyChainFields }
    }
  }
`

export const GET_POLICY_CHAIN = gql`
  ${POLICY_CHAIN_FRAGMENT}
  query GetPolicyChain($apiId: ID!) {
    policyChain(apiId: $apiId) {
      ...PolicyChainFields
    }
  }
`

export const PUBLISH_POLICY_CHAIN = gql`
  ${POLICY_CHAIN_FRAGMENT}
  mutation PublishPolicyChain($apiId: ID!, $input: PublishPolicyChainInput!) {
    publishPolicyChain(apiId: $apiId, input: $input) {
      ...PolicyChainFields
    }
  }
`

export const INVALIDATE_POLICY_CACHE = gql`
  mutation InvalidatePolicyCache($apiId: ID!) {
    invalidatePolicyCache(apiId: $apiId)
  }
`
