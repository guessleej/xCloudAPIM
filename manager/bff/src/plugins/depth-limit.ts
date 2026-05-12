/**
 * GraphQL query depth & complexity 限制
 * 以 Apollo Server 4 plugin 形式掛載
 */
import type { GraphQLRequestListener, ApolloServerPlugin, GraphQLRequestContextDidResolveOperation } from '@apollo/server'
import type { BffContext } from '../context.js'
import { GraphQLError, type SelectionSetNode, type FieldNode, type FragmentDefinitionNode } from 'graphql'

function measureDepth(
  node: SelectionSetNode | undefined,
  fragments: Map<string, FragmentDefinitionNode>,
  depth = 0,
  seen = new Set<string>(),
): number {
  if (!node) return depth
  let max = depth
  for (const sel of node.selections) {
    if (sel.kind === 'Field') {
      const field = sel as FieldNode
      if (field.selectionSet) {
        const d = measureDepth(field.selectionSet, fragments, depth + 1, seen)
        if (d > max) max = d
      }
    } else if (sel.kind === 'InlineFragment' && sel.selectionSet) {
      const d = measureDepth(sel.selectionSet, fragments, depth, seen)
      if (d > max) max = d
    } else if (sel.kind === 'FragmentSpread') {
      const name = sel.name.value
      if (seen.has(name)) continue
      const fragment = fragments.get(name)
      if (!fragment) continue
      const nextSeen = new Set(seen).add(name)
      const d = measureDepth(fragment.selectionSet, fragments, depth, nextSeen)
      if (d > max) max = d
    }
  }
  return max
}

function measureComplexity(
  node: SelectionSetNode | undefined,
  fragments: Map<string, FragmentDefinitionNode>,
  seen = new Set<string>(),
): number {
  if (!node) return 0

  return node.selections.reduce((total, sel) => {
    if (sel.kind === 'Field') {
      return total + 1 + measureComplexity(sel.selectionSet, fragments, seen)
    }
    if (sel.kind === 'InlineFragment') {
      return total + measureComplexity(sel.selectionSet, fragments, seen)
    }
    if (sel.kind === 'FragmentSpread') {
      const name = sel.name.value
      if (seen.has(name)) return total
      const fragment = fragments.get(name)
      if (!fragment) return total
      return total + measureComplexity(fragment.selectionSet, fragments, new Set(seen).add(name))
    }
    return total
  }, 0)
}

export function depthLimitPlugin(maxDepth: number, maxComplexity: number): ApolloServerPlugin<BffContext> {
  return {
    async requestDidStart(): Promise<GraphQLRequestListener<BffContext>> {
      return {
        async didResolveOperation(ctx: GraphQLRequestContextDidResolveOperation<BffContext>) {
          const fragments = new Map<string, FragmentDefinitionNode>()
          for (const def of ctx.document.definitions) {
            if (def.kind === 'FragmentDefinition') {
              fragments.set(def.name.value, def)
            }
          }

          for (const def of ctx.document.definitions) {
            if (def.kind === 'OperationDefinition' && def.selectionSet) {
              const depth = measureDepth(def.selectionSet, fragments)
              if (depth > maxDepth) {
                throw new GraphQLError(
                  `Query depth ${depth} exceeds maximum allowed depth ${maxDepth}`,
                  { extensions: { code: 'QUERY_TOO_DEEP' } },
                )
              }

              const complexity = measureComplexity(def.selectionSet, fragments)
              if (complexity > maxComplexity) {
                throw new GraphQLError(
                  `Query complexity ${complexity} exceeds maximum allowed complexity ${maxComplexity}`,
                  { extensions: { code: 'QUERY_TOO_COMPLEX' } },
                )
              }
            }
          }
        },
      }
    },
  }
}
