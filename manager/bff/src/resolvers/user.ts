import type { BffContext } from '../context.js'
import type { OrgDTO, UserDTO } from '../datasources/auth-api.js'
import { requireAuth } from './helpers.js'

function mapUser(u: UserDTO) {
  return {
    id:        u.id,
    email:     u.email,
    name:      u.name,
    role:      u.role.toUpperCase(),
    orgId:     u.org_id,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  }
}

function mapOrg(o: OrgDTO) {
  return {
    id:          o.id,
    name:        o.name,
    slug:        o.slug,
    description: o.description,
    createdAt:   o.created_at,
    updatedAt:   o.updated_at,
  }
}

export const userResolvers = {
  Query: {
    me: async (_: unknown, __: unknown, ctx: BffContext) => {
      requireAuth(ctx)
      const user = await ctx.authAPI.getMe()
      return mapUser(user)
    },

    organizations: async (
      _: unknown,
      args: { page?: number; limit?: number; search?: string },
      ctx: BffContext,
    ) => {
      requireAuth(ctx)
      const list = await ctx.authAPI.listOrganizations(
        args.page ?? 1,
        args.limit ?? 20,
        args.search,
      )
      return list.map(mapOrg)
    },

    organization: async (_: unknown, args: { id: string }, ctx: BffContext) => {
      requireAuth(ctx)
      const org = await ctx.authAPI.getOrganization(args.id)
      return org ? mapOrg(org) : null
    },
  },

  Mutation: {
    createOrganization: async (
      _: unknown,
      args: { input: { name: string; slug: string; description?: string } },
      ctx: BffContext,
    ) => {
      requireAuth(ctx)
      const org = await ctx.authAPI.createOrganization(args.input)
      return mapOrg(org)
    },

    updateOrganization: async (
      _: unknown,
      args: { id: string; input: { name: string; slug: string; description?: string } },
      ctx: BffContext,
    ) => {
      requireAuth(ctx)
      const org = await ctx.authAPI.updateOrganization(args.id, args.input)
      return mapOrg(org)
    },

    deleteOrganization: async (
      _: unknown,
      args: { id: string },
      ctx: BffContext,
    ) => {
      requireAuth(ctx)
      await ctx.authAPI.deleteOrganization(args.id)
      return true
    },
  },

  // Field resolvers
  User: {
    org: async (parent: { orgId: string | null }, _: unknown, ctx: BffContext) => {
      if (!parent.orgId) return null
      const org = await ctx.loaders.org.load(parent.orgId)
      return org ? mapOrg(org) : null
    },
  },

  Organization: {
    apis: async (
      parent: { id: string },
      args: { page?: number; limit?: number },
      ctx: BffContext,
    ) => {
      const resp = await ctx.registryAPI.listAPIs({
        orgId: parent.id,
        page:  args.page ?? 1,
        limit: args.limit ?? 20,
      })
      return {
        nodes:    resp.data.map(mapAPIFlat),
        pageInfo: buildPageInfo(resp.page, resp.limit, resp.total),
      }
    },

    subscriptions: async (
      parent: { id: string },
      args: { status?: string; page?: number; limit?: number },
      ctx: BffContext,
    ) => {
      const resp = await ctx.subscriptionAPI.listSubscriptions({
        orgId:  parent.id,
        status: args.status,
        page:   args.page ?? 1,
        limit:  args.limit ?? 20,
      })
      return {
        nodes:    resp.data.map(mapSubFlat),
        pageInfo: buildPageInfo(resp.page, resp.limit, resp.total),
      }
    },
  },
}

// ─── shared map helpers (re-used by other resolvers) ──────────
function mapAPIFlat(a: import('../datasources/registry-api.js').APIDTO) {
  return {
    id:            a.id,
    name:          a.name,
    version:       a.version,
    basePath:      a.base_path,
    upstreamUrl:   a.upstream_url,
    description:   a.description,
    status:        a.status.toUpperCase(),
    orgId:         a.org_id,
    tags:          a.tags ?? [],
    timeoutMs:     a.timeout_ms,
    retries:       a.retries,
    stripBasePath: a.strip_base_path,
    createdAt:     a.created_at,
    updatedAt:     a.updated_at,
  }
}

function mapSubFlat(s: import('../datasources/subscription-api.js').SubscriptionDTO) {
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

function buildPageInfo(page: number, limit: number, total: number) {
  const totalPages = Math.ceil(total / limit)
  return { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 }
}
