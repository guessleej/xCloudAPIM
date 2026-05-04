import type { Redis } from 'ioredis'
import type { FastifyBaseLogger } from 'fastify'
import { fetch } from 'undici'
import type {
  ExecContext, PolicyChain, PolicyDef, PolicyPhase, PluginExecutor,
} from './types.js'
import { PHASE_ORDER } from './types.js'
import { authPlugin }      from './plugins/auth/index.js'
import { rateLimit }       from './plugins/rate-limit/index.js'
import { cors }            from './plugins/cors.js'
import { ipWhitelist }     from './plugins/ip-whitelist.js'
import { transformPlugin } from './plugins/transform/index.js'
import { cache }           from './plugins/cache.js'
import { circuitBreaker }  from './plugins/circuit-breaker.js'
import { config }          from '../config/index.js'

// ─── Plugin Registry ──────────────────────────────────────────

const PLUGIN_MAP: Record<string, PluginExecutor> = {
  auth:              authPlugin,
  jwt_auth:          authPlugin,   // 舊格式相容
  api_key_auth:      authPlugin,   // 舊格式相容
  rate_limit:        rateLimit,
  cors:              cors,
  ip_whitelist:      ipWhitelist,
  transform:         transformPlugin,
  request_transform: transformPlugin,   // 舊格式相容
  response_transform: transformPlugin,  // 舊格式相容
  cache:             cache,
  circuit_breaker:   circuitBreaker,
}

// ─── PolicyChain 本地快取 ─────────────────────────────────────

const chainCache = new Map<string, { chain: PolicyChain; fetchedAt: number }>()
const CHAIN_TTL_MS = 5 * 60 * 1000

async function getPolicyChain(
  apiId: string,
  log: FastifyBaseLogger,
): Promise<PolicyChain | null> {
  const cached = chainCache.get(apiId)
  if (cached && Date.now() - cached.fetchedAt < CHAIN_TTL_MS) {
    return cached.chain
  }

  try {
    const resp = await fetch(
      `${config.POLICY_ENGINE_URL}/v1/chains/${apiId}`,
      { signal: AbortSignal.timeout(3000) },
    )
    if (resp.status === 404) return null
    if (!resp.ok) {
      log.warn({ status: resp.status, apiId }, 'policy chain fetch failed')
      return null
    }
    const chain = await resp.json() as PolicyChain
    chainCache.set(apiId, { chain, fetchedAt: Date.now() })
    return chain
  } catch (err) {
    log.warn({ err, apiId }, 'policy chain fetch error')
    // 使用過期快取（寬容模式）
    return cached?.chain ?? null
  }
}

// ─── Executor ─────────────────────────────────────────────────

export interface ExecuteResult {
  aborted:     boolean
  abortCode:   number
  abortMessage: string
  cacheHit:    boolean
  durationMs:  number
}

export async function executePhase(
  ctx:    ExecContext,
  phase:  PolicyPhase,
  redis:  Redis,
  log:    FastifyBaseLogger,
): Promise<ExecuteResult> {
  const start = Date.now()

  const chain = await getPolicyChain(ctx.apiId, log)
  if (!chain) {
    return { aborted: false, abortCode: 0, abortMessage: '', cacheHit: false, durationMs: Date.now() - start }
  }

  // 篩選並排序此 Phase 的 policies
  ctx.phase = phase

  const policies = chain.policies
    .filter((p) => p.enabled && p.phase === phase)
    .sort((a, b) => a.order - b.order)

  for (const policy of policies) {
    if (ctx.aborted || ctx.cacheHit) break
    if (policy.condition && !evalCondition(policy.condition, ctx)) continue

    const executor = PLUGIN_MAP[policy.type]
    if (!executor) {
      log.warn({ type: policy.type }, 'unknown plugin type')
      continue
    }

    try {
      await executor(ctx, { redis, log, config: policy.config })
    } catch (err) {
      log.error({ err, type: policy.type, policyId: policy.id }, 'plugin error')
    }
  }

  return {
    aborted:      ctx.aborted,
    abortCode:    ctx.abortCode,
    abortMessage: ctx.abortMessage,
    cacheHit:     ctx.cacheHit,
    durationMs:   Date.now() - start,
  }
}

/** 條件表達式求值（header.X-Plan=premium | claim.plan=pro | method=POST） */
function evalCondition(cond: string, ctx: ExecContext): boolean {
  const eqIdx = cond.indexOf('=')
  if (eqIdx < 0) return true
  const key      = cond.slice(0, eqIdx).trim()
  const expected = cond.slice(eqIdx + 1).trim()

  if (key.startsWith('header.')) {
    return ctx.requestHeaders[key.slice(7).toLowerCase()] === expected
  }
  if (key.startsWith('claim.')) {
    return String(ctx.claims[key.slice(6)] ?? '') === expected
  }
  if (key === 'method') return ctx.method.toUpperCase() === expected.toUpperCase()
  if (key === 'plan')   return ctx.plan === expected
  return true
}

export { getPolicyChain }
