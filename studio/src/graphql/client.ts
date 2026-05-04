import { ApolloClient, InMemoryCache, createHttpLink, from } from '@apollo/client'
import { onError } from '@apollo/client/link/error'

const errorLink = onError(({ graphQLErrors, networkError }) => {
  if (graphQLErrors) {
    graphQLErrors.forEach(({ message, extensions }) => {
      if (extensions?.['code'] === 'UNAUTHENTICATED') {
        window.location.href = '/login'
      }
      console.warn('[GraphQL]', message)
    })
  }
  if (networkError) console.error('[Network]', networkError)
})

const httpLink = createHttpLink({
  uri: '/graphql',
  headers: {
    authorization: `Bearer ${localStorage.getItem('studio_token') ?? ''}`,
  },
})

export const apolloClient = new ApolloClient({
  link: from([errorLink, httpLink]),
  cache: new InMemoryCache({
    typePolicies: {
      PolicyChain: { keyFields: ['chainId'] },
      API:         { keyFields: ['id'] },
      Policy:      { keyFields: ['id'] },
    },
  }),
  defaultOptions: {
    watchQuery: { fetchPolicy: 'cache-and-network' },
  },
})
