/**
 * GraphQL query depth & complexity 限制
 * 以 Apollo Server 4 plugin 形式掛載
 */
import type { GraphQLRequestListener, ApolloServerPlugin, GraphQLRequestContextDidResolveOperation } from '@apollo/server'
import type { BffContext } from '../context.js'
import { GraphQLError, type SelectionSetNode, type FieldNode } from 'graphql'

function measureDepth(node: SelectionSetNode | undefined, depth = 0): number {
  if (!node) return depth
  let max = depth
  for (const sel of node.selections) {
    if (sel.kind === 'Field') {
      const field = sel as FieldNode
      if (field.selectionSet) {
        const d = measureDepth(field.selectionSet, depth + 1)
        if (d > max) max = d
      }
    } else if (sel.kind === 'InlineFragment' && sel.selectionSet) {
      const d = measureDepth(sel.selectionSet, depth)
      if (d > max) max = d
    }
  }
  return max
}

export function depthLimitPlugin(maxDepth: number): ApolloServerPlugin<BffContext> {
  return {
    async requestDidStart(): Promise<GraphQLRequestListener<BffContext>> {
      return {
        async didResolveOperation(ctx: GraphQLRequestContextDidResolveOperation<BffContext>) {
          for (const def of ctx.document.definitions) {
            if (def.kind === 'OperationDefinition' && def.selectionSet) {
              const depth = measureDepth(def.selectionSet)
              if (depth > maxDepth) {
                throw new GraphQLError(
                  `Query depth ${depth} exceeds maximum allowed depth ${maxDepth}`,
                  { extensions: { code: 'QUERY_TOO_DEEP' } },
                )
              }
            }
          }
        },
      }
    },
  }
}
