/**
 * Apollo Server 4 Context — 每個請求建立獨立的 datasource instances
 * Auth middleware 在這裡驗 JWT，解出 user 資訊
 */
import { createRemoteJWKSet, jwtVerify } from 'jose'
import DataLoader from 'dataloader'
import type { Logger } from 'pino'
import { config } from './config/index.js'
import { AuthAPI, type UserDTO, type OrgDTO } from './datasources/auth-api.js'
import { RegistryAPI, type APIDTO } from './datasources/registry-api.js'
import { SubscriptionAPI, type PlanDTO, type SubscriptionDTO } from './datasources/subscription-api.js'
import { PolicyAPI } from './datasources/policy-api.js'

// ─── JWKS 快取（module scope，跨請求共享）─────────────────────
let jwksSet: ReturnType<typeof createRemoteJWKSet> | null = null
let jwksFetchedAt = 0

function getJWKS(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwksSet || Date.now() - jwksFetchedAt > config.JWKS_CACHE_TTL_MS) {
    jwksSet = createRemoteJWKSet(new URL(config.JWKS_URL))
    jwksFetchedAt = Date.now()
  }
  return jwksSet
}

export interface AuthUser {
  id:    string
  email: string
  role:  string
  orgId: string | null
  sub:   string
}

export interface BffContext {
  user:         AuthUser | null
  authHeader:   string | undefined
  log:          Logger

  // Datasources
  authAPI:         AuthAPI
  registryAPI:     RegistryAPI
  subscriptionAPI: SubscriptionAPI
  policyAPI:       PolicyAPI

  // DataLoaders（N+1 防護）
  loaders: {
    org:          DataLoader<string, OrgDTO | null>
    api:          DataLoader<string, APIDTO | null>
    plan:         DataLoader<string, PlanDTO | null>
    subscription: DataLoader<string, SubscriptionDTO | null>
  }
}

export async function buildContext(
  authHeader: string | undefined,
  log: Logger,
): Promise<BffContext> {
  // ─── JWT 驗證 ──────────────────────────────────────────────
  let user: AuthUser | null = null

  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim()
    try {
      const { payload } = await jwtVerify(token, getJWKS(), {
        issuer:   config.JWT_ISSUER   || undefined,
        audience: config.JWT_AUDIENCE || undefined,
      })
      user = {
        id:    String(payload['uid'] ?? payload.sub ?? ''),
        email: String(payload['email'] ?? ''),
        role:  String(payload['role']  ?? 'VIEWER'),
        orgId: payload['org_id'] ? String(payload['org_id']) : null,
        sub:   payload.sub ?? '',
      }
    } catch (err) {
      log.debug({ err }, 'JWT verification failed')
    }
  }

  // ─── Datasource instances ─────────────────────────────────
  const authAPI         = new AuthAPI(log, authHeader)
  const registryAPI     = new RegistryAPI(log, authHeader)
  const subscriptionAPI = new SubscriptionAPI(log, authHeader)
  const policyAPI       = new PolicyAPI(log, authHeader)

  // ─── DataLoaders ──────────────────────────────────────────
  const loaders = {
    org: new DataLoader<string, OrgDTO | null>(async (ids) => {
      const list = await authAPI.listOrganizations(1, ids.length)
      const map = new Map(list.map((o) => [o.id, o]))
      return ids.map((id) => map.get(id) ?? null)
    }),

    api: new DataLoader<string, APIDTO | null>(async (ids) => {
      const list = await registryAPI.getAPIsByIds([...ids])
      const map = new Map(list.map((a) => [a.id, a]))
      return ids.map((id) => map.get(id) ?? null)
    }),

    plan: new DataLoader<string, PlanDTO | null>(async (ids) => {
      const list = await subscriptionAPI.getPlansByIds([...ids])
      const map = new Map(list.map((p) => [p.id, p]))
      return ids.map((id) => map.get(id) ?? null)
    }),

    subscription: new DataLoader<string, SubscriptionDTO | null>(async (ids) => {
      const list = await subscriptionAPI.getSubscriptionsByIds([...ids])
      const map = new Map(list.map((s) => [s.id, s]))
      return ids.map((id) => map.get(id) ?? null)
    }),
  }

  return {
    user,
    authHeader,
    log,
    authAPI,
    registryAPI,
    subscriptionAPI,
    policyAPI,
    loaders,
  }
}
