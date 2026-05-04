'use client'
/**
 * ApolloProvider for Client Components — wraps children with Apollo context
 */
import { ApolloNextAppProvider, NextSSRApolloClient, InMemoryCache } from '@apollo/experimental-nextjs-app-support/ssr'

function makeClientSide() {
  return new NextSSRApolloClient({
    cache: new InMemoryCache(),
    uri:   '/graphql',
  })
}

export default function ApolloProvider({ children }: { children: React.ReactNode }) {
  return (
    <ApolloNextAppProvider makeClient={makeClientSide}>
      {children}
    </ApolloNextAppProvider>
  )
}
