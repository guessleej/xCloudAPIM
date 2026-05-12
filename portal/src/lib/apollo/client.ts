/**
 * Apollo Client — Next.js 14 App Router 相容設定
 * 使用 @apollo/experimental-nextjs-app-support 的 registerApolloClient
 * 讓 RSC 與 Client Component 共用同一個 cache instance per request
 */
import { ApolloClient, InMemoryCache, HttpLink, from } from '@apollo/client'
import { setContext } from '@apollo/client/link/context'
import { onError } from '@apollo/client/link/error'
import { registerApolloClient } from '@apollo/experimental-nextjs-app-support/rsc'

const BFF_URL =
  typeof window === 'undefined'
    ? (process.env.BFF_URL ?? 'http://localhost:4000/graphql')
    : '/graphql'

const httpLink = new HttpLink({ uri: BFF_URL, fetchOptions: { cache: 'no-store' } })

const errorLink = onError(({ graphQLErrors, networkError }) => {
  if (graphQLErrors) {
    graphQLErrors.forEach(({ message, locations, path }) =>
      console.error(`[GraphQL error]: ${message}`, { locations, path }),
    )
  }
  if (networkError) console.error(`[Network error]: ${networkError}`)
})

function makeClient(authToken?: string) {
  const authLink = setContext((_, { headers }) => ({
    headers: {
      ...headers,
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
    },
  }))

  return new ApolloClient({
    devtools: { enabled: false },
    cache: new InMemoryCache({
      typePolicies: {
        Query: {
          fields: {
            apis:           { keyArgs: ['filter', 'sort'] },
            subscriptions:  { keyArgs: ['filter'] },
          },
        },
      },
    }),
    link: from([errorLink, authLink, httpLink]),
  })
}

// ── RSC client (per-request, no auth) ────────────────────────
export const { getClient: getRscClient } = registerApolloClient(() => makeClient())

// ── Authenticated RSC client factory ─────────────────────────
export function getAuthClient(token: string) {
  return makeClient(token)
}
