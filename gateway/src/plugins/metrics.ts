import fp from 'fastify-plugin'
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client'
import type { FastifyPluginAsync } from 'fastify'

export interface GatewayMetrics {
  requestsTotal:    Counter<string>
  requestDuration:  Histogram<string>
  requestSize:      Histogram<string>
  responseSize:     Histogram<string>
  upstreamErrors:   Counter<string>
  rateLimitHits:    Counter<string>
  cacheHits:        Counter<string>
  circuitBreakerOpen: Gauge<string>
}

declare module 'fastify' {
  interface FastifyInstance {
    metrics:  GatewayMetrics
    registry: Registry
  }
}

const metricsPlugin: FastifyPluginAsync = async (fastify) => {
  const registry = new Registry()
  collectDefaultMetrics({ register: registry })

  const metrics: GatewayMetrics = {
    requestsTotal: new Counter({
      name: 'gateway_requests_total',
      help: 'Total number of requests processed',
      labelNames: ['method', 'route', 'status', 'api_id'],
      registers: [registry],
    }),
    requestDuration: new Histogram({
      name: 'gateway_request_duration_seconds',
      help: 'Request duration in seconds',
      labelNames: ['method', 'route', 'status', 'api_id'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    }),
    requestSize: new Histogram({
      name: 'gateway_request_size_bytes',
      help: 'Request body size in bytes',
      labelNames: ['api_id'],
      buckets: [100, 1024, 10240, 102400, 1048576],
      registers: [registry],
    }),
    responseSize: new Histogram({
      name: 'gateway_response_size_bytes',
      help: 'Response body size in bytes',
      labelNames: ['api_id'],
      buckets: [100, 1024, 10240, 102400, 1048576],
      registers: [registry],
    }),
    upstreamErrors: new Counter({
      name: 'gateway_upstream_errors_total',
      help: 'Total upstream errors',
      labelNames: ['api_id', 'error_type'],
      registers: [registry],
    }),
    rateLimitHits: new Counter({
      name: 'gateway_rate_limit_hits_total',
      help: 'Total rate limit rejections',
      labelNames: ['api_id', 'key_by'],
      registers: [registry],
    }),
    cacheHits: new Counter({
      name: 'gateway_cache_hits_total',
      help: 'Total cache hits',
      labelNames: ['api_id', 'hit'],
      registers: [registry],
    }),
    circuitBreakerOpen: new Gauge({
      name: 'gateway_circuit_breaker_open',
      help: '1 if circuit breaker is open, 0 otherwise',
      labelNames: ['api_id'],
      registers: [registry],
    }),
  }

  fastify.decorate('metrics', metrics)
  fastify.decorate('registry', registry)

  // Expose /metrics endpoint
  fastify.get('/metrics', {
    schema: { hide: true },
  }, async (_req, reply) => {
    reply.header('Content-Type', registry.contentType)
    return registry.metrics()
  })
}

export default fp(metricsPlugin, { name: 'metrics' })
