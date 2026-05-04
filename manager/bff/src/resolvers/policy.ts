import type { BffContext } from '../context.js'
import type { PolicyChainDTO } from '../datasources/policy-api.js'
import { requireAuth, notFound } from './helpers.js'

function mapChain(c: PolicyChainDTO) {
  return {
    chainId:   c.chain_id,
    apiId:     c.api_id,
    version:   c.version,
    etag:      c.etag,
    updatedAt: c.updated_at,
    policies:  c.policies.map((p) => ({
      id:        p.id,
      type:      p.type,
      phase:     p.phase.toUpperCase(),
      order:     p.order,
      enabled:   p.enabled,
      config:    p.config,
      condition: p.condition,
    })),
  }
}

export const policyResolvers = {
  Query: {
    policyChain: async (_: unknown, args: { apiId: string }, ctx: BffContext) => {
      requireAuth(ctx)
      const chain = await ctx.policyAPI.getPolicyChain(args.apiId)
      if (!chain) notFound('PolicyChain', args.apiId)
      return mapChain(chain)
    },
  },

  Mutation: {
    publishPolicyChain: async (
      _: unknown,
      args: {
        apiId: string
        input: {
          policies: Array<{
            type:      string
            phase:     string
            order:     number
            enabled:   boolean
            config:    Record<string, string>
            condition?: string
          }>
        }
      },
      ctx: BffContext,
    ) => {
      requireAuth(ctx)
      const chain = await ctx.policyAPI.publishPolicyChain(args.apiId, {
        policies: args.input.policies.map((p) => ({
          ...p,
          phase: p.phase.toLowerCase(),
        })),
      })
      return mapChain(chain)
    },

    invalidatePolicyCache: async (_: unknown, args: { apiId: string }, ctx: BffContext) => {
      requireAuth(ctx)
      await ctx.policyAPI.invalidateCache(args.apiId)
      return true
    },
  },
}
