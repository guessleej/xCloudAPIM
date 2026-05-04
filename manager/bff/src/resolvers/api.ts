import type { BffContext } from '../context.js'
import type { APIDTO } from '../datasources/registry-api.js'
import type { OrgDTO } from '../datasources/auth-api.js'
import { requireAuth, buildPageInfo, notFound } from './helpers.js'

function mapAPI(a: APIDTO) {
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

export const apiResolvers = {
  Query: {
    apis: async (
      _: unknown,
      args: { orgId?: string; status?: string; page?: number; limit?: number },
      ctx: BffContext,
    ) => {
      requireAuth(ctx)
      const resp = await ctx.registryAPI.listAPIs({
        orgId:  args.orgId,
        status: args.status?.toLowerCase(),
        page:   args.page ?? 1,
        limit:  args.limit ?? 20,
      })
      return {
        nodes:    resp.data.map(mapAPI),
        pageInfo: buildPageInfo(resp.page, resp.limit, resp.total),
      }
    },

    api: async (_: unknown, args: { id: string }, ctx: BffContext) => {
      requireAuth(ctx)
      const api = await ctx.registryAPI.getAPI(args.id)
      if (!api) notFound('API', args.id)
      return mapAPI(api)
    },
  },

  Mutation: {
    createAPI: async (
      _: unknown,
      args: {
        input: {
          name: string; version: string; basePath: string; upstreamUrl: string
          description?: string; orgId: string; tags?: string[]
          timeoutMs?: number; retries?: number; stripBasePath?: boolean
        }
      },
      ctx: BffContext,
    ) => {
      requireAuth(ctx)
      const { input } = args
      const api = await ctx.registryAPI.createAPI({
        name:           input.name,
        version:        input.version,
        base_path:      input.basePath,
        upstream_url:   input.upstreamUrl,
        description:    input.description,
        org_id:         input.orgId,
        tags:           input.tags,
        timeout_ms:     input.timeoutMs,
        retries:        input.retries,
        strip_base_path: input.stripBasePath,
      })
      return mapAPI(api)
    },

    updateAPI: async (
      _: unknown,
      args: {
        id: string
        input: {
          name?: string; upstreamUrl?: string; description?: string; status?: string
          tags?: string[]; timeoutMs?: number; retries?: number; stripBasePath?: boolean
        }
      },
      ctx: BffContext,
    ) => {
      requireAuth(ctx)
      const { input } = args
      const api = await ctx.registryAPI.updateAPI(args.id, {
        name:           input.name,
        upstream_url:   input.upstreamUrl,
        description:    input.description,
        status:         input.status?.toLowerCase(),
        tags:           input.tags,
        timeout_ms:     input.timeoutMs,
        retries:        input.retries,
        strip_base_path: input.stripBasePath,
      })
      return mapAPI(api)
    },

    deleteAPI: async (_: unknown, args: { id: string }, ctx: BffContext) => {
      requireAuth(ctx)
      await ctx.registryAPI.deleteAPI(args.id)
      return true
    },
  },

  API: {
    org: async (parent: { orgId: string }, _: unknown, ctx: BffContext) => {
      const org = await ctx.loaders.org.load(parent.orgId)
      return org ? mapOrg(org) : null
    },

    policyChain: async (parent: { id: string }, _: unknown, ctx: BffContext) => {
      const chain = await ctx.policyAPI.getPolicyChain(parent.id)
      if (!chain) return null
      return mapPolicyChain(chain)
    },
  },
}

function mapPolicyChain(c: import('../datasources/policy-api.js').PolicyChainDTO) {
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
