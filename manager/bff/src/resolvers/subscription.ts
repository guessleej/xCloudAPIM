import type { BffContext } from '../context.js'
import type { PlanDTO, SubscriptionDTO, APIKeyDTO } from '../datasources/subscription-api.js'
import type { APIDTO } from '../datasources/registry-api.js'
import type { OrgDTO } from '../datasources/auth-api.js'
import { requireAuth, buildPageInfo, notFound } from './helpers.js'

function mapPlan(p: PlanDTO) {
  return {
    id:          p.id,
    name:        p.name,
    description: p.description,
    rpmLimit:    p.rpm_limit,
    rpdLimit:    p.rpd_limit,
    rphLimit:    p.rph_limit,
    maxKeys:     p.max_keys,
    price:       p.price,
    currency:    p.currency,
    features:    p.features ?? [],
    isPublic:    p.is_public,
    createdAt:   p.created_at,
  }
}

function mapSub(s: SubscriptionDTO) {
  return {
    id:        s.id,
    orgId:     s.org_id,
    planId:    s.plan_id,
    apiId:     s.api_id,
    status:    s.status.toUpperCase(),
    expiresAt: s.expires_at,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  }
}

function mapKey(k: APIKeyDTO) {
  return {
    id:             k.id,
    keyId:          k.key_id,
    subscriptionId: k.subscription_id,
    name:           k.name,
    status:         k.status.toUpperCase(),
    allowedIps:     k.allowed_ips ?? [],
    allowedOrigins: k.allowed_origins ?? [],
    scopes:         k.scopes ?? [],
    expiresAt:      k.expires_at,
    lastUsedAt:     k.last_used_at,
    createdAt:      k.created_at,
  }
}

function mapOrg(o: OrgDTO)   { return { id: o.id, name: o.name, slug: o.slug, description: o.description, createdAt: o.created_at, updatedAt: o.updated_at } }
function mapAPI(a: APIDTO)   { return { id: a.id, name: a.name, version: a.version, basePath: a.base_path, upstreamUrl: a.upstream_url, description: a.description, status: a.status.toUpperCase(), orgId: a.org_id, tags: a.tags ?? [], timeoutMs: a.timeout_ms, retries: a.retries, stripBasePath: a.strip_base_path, createdAt: a.created_at, updatedAt: a.updated_at } }

export const subscriptionResolvers = {
  Query: {
    plans: async (_: unknown, args: { isPublic?: boolean }, ctx: BffContext) => {
      requireAuth(ctx)
      const list = await ctx.subscriptionAPI.listPlans(args.isPublic)
      return list.map(mapPlan)
    },

    plan: async (_: unknown, args: { id: string }, ctx: BffContext) => {
      requireAuth(ctx)
      const plan = await ctx.subscriptionAPI.getPlan(args.id)
      if (!plan) notFound('Plan', args.id)
      return mapPlan(plan)
    },

    subscriptions: async (
      _: unknown,
      args: { orgId?: string; apiId?: string; status?: string; page?: number; limit?: number },
      ctx: BffContext,
    ) => {
      requireAuth(ctx)
      const resp = await ctx.subscriptionAPI.listSubscriptions({
        orgId:  args.orgId,
        apiId:  args.apiId,
        status: args.status?.toLowerCase(),
        page:   args.page ?? 1,
        limit:  args.limit ?? 20,
      })
      return {
        nodes:    resp.data.map(mapSub),
        pageInfo: buildPageInfo(resp.page, resp.limit, resp.total),
      }
    },

    subscription: async (_: unknown, args: { id: string }, ctx: BffContext) => {
      requireAuth(ctx)
      const sub = await ctx.subscriptionAPI.getSubscription(args.id)
      if (!sub) notFound('Subscription', args.id)
      return mapSub(sub)
    },

    apiKeys: async (_: unknown, args: { subscriptionId: string }, ctx: BffContext) => {
      requireAuth(ctx)
      const keys = await ctx.subscriptionAPI.listAPIKeys(args.subscriptionId)
      return keys.map(mapKey)
    },

    apiKey: async (_: unknown, args: { id: string }, ctx: BffContext) => {
      requireAuth(ctx)
      const key = await ctx.subscriptionAPI.getAPIKey(args.id)
      if (!key) notFound('APIKey', args.id)
      return mapKey(key)
    },
  },

  Mutation: {
    createPlan: async (_: unknown, args: { input: Record<string, unknown> }, ctx: BffContext) => {
      requireAuth(ctx)
      const { input } = args
      const plan = await ctx.subscriptionAPI.createPlan({
        name:        input['name'] as string,
        description: input['description'] as string | undefined,
        rpm_limit:   input['rpmLimit'] as number,
        rpd_limit:   input['rpdLimit'] as number,
        rph_limit:   (input['rphLimit'] as number | undefined) ?? 0,
        max_keys:    input['maxKeys'] as number,
        price:       input['price'] as number,
        currency:    (input['currency'] as string | undefined) ?? 'USD',
        features:    input['features'] as string[] | undefined,
        is_public:   input['isPublic'] as boolean | undefined,
      })
      return mapPlan(plan)
    },

    updatePlan: async (_: unknown, args: { id: string; input: Record<string, unknown> }, ctx: BffContext) => {
      requireAuth(ctx)
      const plan = await ctx.subscriptionAPI.updatePlan(args.id, args.input)
      return mapPlan(plan)
    },

    deletePlan: async (_: unknown, args: { id: string }, ctx: BffContext) => {
      requireAuth(ctx)
      await ctx.subscriptionAPI.deletePlan(args.id)
      return true
    },

    createSubscription: async (
      _: unknown,
      args: { input: { orgId: string; planId: string; apiId: string; expiresAt?: string } },
      ctx: BffContext,
    ) => {
      requireAuth(ctx)
      const { input } = args
      const sub = await ctx.subscriptionAPI.createSubscription({
        org_id:     input.orgId,
        plan_id:    input.planId,
        api_id:     input.apiId,
        expires_at: input.expiresAt,
      })
      return mapSub(sub)
    },

    updateSubscriptionStatus: async (
      _: unknown,
      args: { id: string; status: string },
      ctx: BffContext,
    ) => {
      requireAuth(ctx)
      const sub = await ctx.subscriptionAPI.updateSubscriptionStatus(
        args.id, args.status.toLowerCase(),
      )
      return mapSub(sub)
    },

    cancelSubscription: async (_: unknown, args: { id: string }, ctx: BffContext) => {
      requireAuth(ctx)
      const sub = await ctx.subscriptionAPI.updateSubscriptionStatus(args.id, 'cancelled')
      return mapSub(sub)
    },

    createAPIKey: async (
      _: unknown,
      args: {
        input: {
          subscriptionId: string; name: string
          allowedIps?: string[]; allowedOrigins?: string[]
          scopes?: string[]; expiresAt?: string
        }
      },
      ctx: BffContext,
    ) => {
      requireAuth(ctx)
      const { input } = args
      const key = await ctx.subscriptionAPI.createAPIKey({
        subscription_id: input.subscriptionId,
        name:            input.name,
        allowed_ips:     input.allowedIps,
        allowed_origins: input.allowedOrigins,
        scopes:          input.scopes,
        expires_at:      input.expiresAt,
      })
      return mapKey(key)
    },

    revokeAPIKey: async (_: unknown, args: { id: string }, ctx: BffContext) => {
      requireAuth(ctx)
      const key = await ctx.subscriptionAPI.revokeAPIKey(args.id)
      return mapKey(key)
    },
  },

  // ─── Field resolvers ─────────────────────────────────────────

  Subscription: {
    org: async (parent: { orgId: string }, _: unknown, ctx: BffContext) => {
      const org = await ctx.loaders.org.load(parent.orgId)
      return org ? mapOrg(org) : null
    },
    plan: async (parent: { planId: string }, _: unknown, ctx: BffContext) => {
      const plan = await ctx.loaders.plan.load(parent.planId)
      return plan ? mapPlan(plan) : null
    },
    api: async (parent: { apiId: string }, _: unknown, ctx: BffContext) => {
      const api = await ctx.loaders.api.load(parent.apiId)
      return api ? mapAPI(api) : null
    },
    apiKeys: async (parent: { id: string }, args: { status?: string }, ctx: BffContext) => {
      const keys = await ctx.subscriptionAPI.listAPIKeys(parent.id, args.status?.toLowerCase())
      return keys.map(mapKey)
    },
  },

  APIKey: {
    subscription: async (parent: { subscriptionId: string }, _: unknown, ctx: BffContext) => {
      const sub = await ctx.loaders.subscription.load(parent.subscriptionId)
      return sub ? mapSub(sub) : null
    },
  },
}
