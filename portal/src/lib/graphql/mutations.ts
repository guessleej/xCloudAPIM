import { gql } from '@apollo/client'

export const CREATE_SUBSCRIPTION = gql`
  mutation CreateSubscription($input: CreateSubscriptionInput!) {
    createSubscription(input: $input) {
      id status
      plan { id name }
      api { id name }
    }
  }
`

export const CANCEL_SUBSCRIPTION = gql`
  mutation CancelSubscription($id: ID!) {
    cancelSubscription(id: $id) { id status }
  }
`

export const CREATE_API_KEY = gql`
  mutation CreateAPIKey($input: CreateAPIKeyInput!) {
    createAPIKey(input: $input) {
      id name keyPrefix subscriptionId
      plainKey   # returned only on creation
      status createdAt
    }
  }
`

export const REVOKE_API_KEY = gql`
  mutation RevokeAPIKey($subscriptionId: ID!, $id: ID!) {
    revokeAPIKey(subscriptionId: $subscriptionId, id: $id)
  }
`
