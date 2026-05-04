import { gql } from '@apollo/client'

export const LOGIN = gql`
  mutation Login($email: String!, $password: String!) {
    login(email: $email, password: $password) {
      token expiresAt
      user { id email name role organizations { id name } }
    }
  }
`

export const REGISTER = gql`
  mutation Register($input: RegisterInput!) {
    register(input: $input) {
      token expiresAt
      user { id email name role }
    }
  }
`

export const CREATE_SUBSCRIPTION = gql`
  mutation CreateSubscription($planId: ID!, $appName: String!) {
    createSubscription(planId: $planId, appName: $appName) {
      id status appName
      plan { id name api { id name } }
    }
  }
`

export const CANCEL_SUBSCRIPTION = gql`
  mutation CancelSubscription($id: ID!) {
    cancelSubscription(id: $id) { id status }
  }
`

export const CREATE_API_KEY = gql`
  mutation CreateAPIKey($subscriptionId: ID!, $name: String!) {
    createAPIKey(subscriptionId: $subscriptionId, name: $name) {
      id name keyPrefix
      plainKey   # returned only on creation
      status createdAt
    }
  }
`

export const REVOKE_API_KEY = gql`
  mutation RevokeAPIKey($id: ID!) {
    revokeAPIKey(id: $id) { id status }
  }
`

export const ROTATE_API_KEY = gql`
  mutation RotateAPIKey($id: ID!) {
    rotateAPIKey(id: $id) {
      id name keyPrefix plainKey status createdAt
    }
  }
`
