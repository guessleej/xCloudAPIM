/**
 * Analytics REST API
 *
 * GET /v1/metrics/summary?apiId=&from=&to=&granularity=hour|day
 * GET /v1/metrics/timeseries?apiId=&clientId=&from=&to=&granularity=
 * GET /v1/metrics/top-clients?apiId=&from=&to=&limit=10
 * GET /v1/metrics/quota?apiId=&from=&to=
 * GET /v1/metrics/realtime?apiId=&clientId=
 */
import type { FastifyInstance } from 'fastify'
import type { Redis } from 'ioredis'
import {
  getAPISummary, getTimeSeries, getTopClients, getQuotaEvents,
} from '../store/repository.js'
import { getRealtimeStats } from '../aggregator/realtime.js'

function parseDateParam(val: string | undefined, fallback: Date): Date {
  if (!val) return fallback
  const d = new Date(val)
  return isNaN(d.getTime()) ? fallback : d
}

export function registerRoutes(app: FastifyInstance, redis: Redis): void {
  // ─── Summary ────────────────────────────────────────────────
  app.get('/v1/metrics/summary', async (req, reply) => {
    const { apiId, from, to, granularity } = req.query as Record<string, string>
    if (!apiId) return reply.code(400).send({ error: 'apiId required' })

    const toDate   = parseDateParam(to, new Date())
    const fromDate = parseDateParam(from, new Date(Date.now() - 24 * 3600_000))
    const gran: 'hour' | 'day' = granularity === 'day' ? 'day' : 'hour'

    const summary = await getAPISummary(apiId, fromDate, toDate, gran)
    return reply.send(summary)
  })

  // ─── Time Series ─────────────────────────────────────────────
  app.get('/v1/metrics/timeseries', async (req, reply) => {
    const { apiId, clientId, from, to, granularity } = req.query as Record<string, string>
    if (!apiId) return reply.code(400).send({ error: 'apiId required' })

    const toDate   = parseDateParam(to, new Date())
    const fromDate = parseDateParam(from, new Date(Date.now() - 24 * 3600_000))
    const gran: 'hour' | 'day' = granularity === 'day' ? 'day' : 'hour'

    const data = await getTimeSeries(apiId, clientId, fromDate, toDate, gran)
    return reply.send({ data })
  })

  // ─── Top Clients ─────────────────────────────────────────────
  app.get('/v1/metrics/top-clients', async (req, reply) => {
    const { apiId, from, to, limit } = req.query as Record<string, string>
    if (!apiId) return reply.code(400).send({ error: 'apiId required' })

    const toDate   = parseDateParam(to, new Date())
    const fromDate = parseDateParam(from, new Date(Date.now() - 24 * 3600_000))

    const data = await getTopClients(apiId, fromDate, toDate, parseInt(limit ?? '10', 10))
    return reply.send({ data })
  })

  // ─── Quota Events ────────────────────────────────────────────
  app.get('/v1/metrics/quota', async (req, reply) => {
    const { apiId, from, to } = req.query as Record<string, string>
    if (!apiId) return reply.code(400).send({ error: 'apiId required' })

    const toDate   = parseDateParam(to, new Date())
    const fromDate = parseDateParam(from, new Date(Date.now() - 24 * 3600_000))

    const data = await getQuotaEvents(apiId, fromDate, toDate)
    return reply.send({ data })
  })

  // ─── Realtime ────────────────────────────────────────────────
  app.get('/v1/metrics/realtime', async (req, reply) => {
    const { apiId, clientId } = req.query as Record<string, string>
    if (!apiId) return reply.code(400).send({ error: 'apiId required' })

    const stats = await getRealtimeStats(redis, apiId, clientId ?? '')
    return reply.send(stats)
  })
}
