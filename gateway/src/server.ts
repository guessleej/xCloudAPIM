import Fastify, { type FastifyReply } from 'fastify'
import helmet from '@fastify/helmet'
import underPressure from '@fastify/under-pressure'

import { config } from './config/index.js'
import redisPlugin from './plugins/redis.js'
import metricsPlugin from './plugins/metrics.js'
import requestIdPlugin from './middleware/request-id.js'
import {
  matchRoute, syncRoutes, loadFromCache, fullSync, getRouteCount,
} from './proxy/route-table.js'
import { forwardRequest } from './proxy/upstream.js'
import { createExecContext, type ExecContext } from './pipeline/types.js'
import { executePhase } from './pipeline/executor.js'

export async function buildServer() {
  const server = Fastify({
    logger: {
      level: config.NODE_ENV === 'production' ? 'info' : 'debug',
    },
    requestIdHeader:   'x-request-id',
    requestIdLogLabel: 'reqId',
    bodyLimit:         config.MAX_BODY_SIZE_MB * 1024 * 1024,
    trustProxy:        true,
  })

  // ─── Plugins ──────────────────────────────────────────────
  await server.register(redisPlugin)
  await server.register(metricsPlugin)
  await server.register(requestIdPlugin)
  await server.register(helmet, { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false })
  await server.register(underPressure, {
    maxEventLoopDelay: 1000,
    maxEventLoopUtilization: 0.98,
    message: 'Under pressure!',
    retryAfter: 50,
  })

  // ─── Health ───────────────────────────────────────────────
  server.get('/healthz', { schema: { hide: true } }, async (_req, reply) => {
    const redisOk = await server.redis.ping().then(() => true).catch(() => false)
    const status  = redisOk ? 200 : 503
    return reply.code(status).send({ status: redisOk ? 'ok' : 'degraded', routes: getRouteCount() })
  })

  // ─── Gateway Catch-all ────────────────────────────────────
  server.all('/*', { schema: { hide: true } }, async (request, reply) => {
    const startMs = Date.now()
    const method  = request.method
    const host    = (request.headers['host'] as string ?? '').split(':')[0]!
    const url     = new URL(request.url, 'http://localhost')
    const path    = url.pathname
    const query   = url.search.slice(1)

    // Route lookup
    const route = matchRoute(host, path, method)
    if (!route) {
      return reply.code(404).send({ error: 'no route found' })
    }

    // Normalise headers to lowercase Record<string,string>
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(request.headers)) {
      if (typeof v === 'string') headers[k.toLowerCase()] = v
      else if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(', ')
    }

    const queryParams: Record<string, string> = {}
    for (const [k, v] of url.searchParams) queryParams[k] = v

    const rawBody = request.body
    const bodyBuf = rawBody instanceof Buffer ? rawBody
      : rawBody != null ? Buffer.from(JSON.stringify(rawBody))
      : null

    const ctx = createExecContext(
      route.apiId, headers['x-trace-id'] ?? request.id,
      method, path, host, request.ip,
      headers, queryParams, bodyBuf,
    )

    const { redis, log } = server

    // ─── pre_request ──────────────────────────────────────
    await executePhase(ctx, 'pre_request', redis, log)
    if (ctx.aborted) return flushAbort(reply, ctx)
    if (ctx.cacheHit) return flushCtxResponse(reply, ctx)

    // ─── Proxy ────────────────────────────────────────────
    const upResp = await forwardRequest(route, {
      method, path: ctx.path, query, headers: ctx.requestHeaders, body: ctx.requestBody,
    })
    ctx.statusCode      = upResp.status
    ctx.responseBody    = upResp.body
    ctx.responseHeaders = upResp.headers

    // ─── post_response ────────────────────────────────────
    await executePhase(ctx, 'post_response', redis, log)

    // ─── Metrics ──────────────────────────────────────────
    const labels = { method, route: route.pathPrefix, status: String(ctx.statusCode), api_id: route.apiId }
    server.metrics.requestsTotal.inc(labels)
    server.metrics.requestDuration.observe(labels, (Date.now() - startMs) / 1000)

    return flushCtxResponse(reply, ctx)
  })

  // ─── Route Table Init ─────────────────────────────────────
  server.addHook('onReady', async () => {
    await loadFromCache(server.redis, server.log)
    await fullSync(server.redis, server.log)
    setInterval(() => syncRoutes(server.redis, server.log), config.ROUTE_REFRESH_INTERVAL_MS)
  })

  return server
}

// ─── helpers ─────────────────────────────────────────────────

function applyResponseHeaders(reply: FastifyReply, ctx: ExecContext): void {
  for (const [k, v] of Object.entries(ctx.responseHeaders)) {
    reply.header(k, v)
  }
}

function flushAbort(reply: FastifyReply, ctx: ExecContext): ReturnType<FastifyReply['send']> {
  applyResponseHeaders(reply, ctx)
  for (const [k, v] of Object.entries(ctx.abortHeaders ?? {})) {
    reply.header(k, v)
  }
  if (ctx.abortCode === 204) return reply.code(204).send()
  return reply.code(ctx.abortCode).send({ error: ctx.abortMessage })
}

function flushCtxResponse(reply: FastifyReply, ctx: ExecContext): ReturnType<FastifyReply['send']> {
  applyResponseHeaders(reply, ctx)
  return reply.code(ctx.statusCode).send(ctx.responseBody)
}
