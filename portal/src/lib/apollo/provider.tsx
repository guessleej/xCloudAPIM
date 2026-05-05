'use client'
/**
 * ApolloProvider for Client Components — wraps children with Apollo context
 */
import { ApolloNextAppProvider, ApolloClient, InMemoryCache } from '@apollo/experimental-nextjs-app-support'
import { HttpLink } from '@apollo/client'

function makeClientSide() {
  return new ApolloClient({
    cache: new InMemoryCache(),
    link:  new HttpLink({ uri: '/graphql' }),
  })
}

export default function ApolloProvider({ children }: { children: React.ReactNode }) {
  return (
    <ApolloNextAppProvider makeClient={makeClientSide}>
      {children}
    </ApolloNextAppProvider>
  )
}
