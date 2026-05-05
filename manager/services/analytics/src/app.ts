import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import underPressure from '@fastify/under-pressure'
import { pino } from 'pino'
import { Redis } from 'ioredis'
import { register as promRegister } from 'prom-client'
import { config } from './config/index.js'
import { connectMongo, closeMongo } from './store/mongodb.js'
import { startKafkaConsumer, stopKafkaConsumer } from './kafka/consumer.js'
import { registerRoutes } from './http/routes.js'

const log = pino({
  level: config.NODE_ENV === 'production' ? 'info' : 'debug',
})

async function main(): Promise<void> {
  // ─── Redis ───────────────────────────────────────────────────
  const redis = new Redis({
    host:     config.REDIS_HOST,
    port:     config.REDIS_PORT,
    password: config.REDIS_PASSWORD || undefined,
    db:       config.REDIS_DB,
    lazyConnect: true,
  })
  await redis.connect()
  log.info('Redis connected')

  // ─── MongoDB ─────────────────────────────────────────────────
  await connectMongo(log)

  // ─── Kafka consumer ──────────────────────────────────────────
  await startKafkaConsumer(redis, log)

  // ─── HTTP server ──────────────────────────────────────────────
  const app = Fastify({ logger: { level: config.NODE_ENV === 'production' ? 'info' : 'debug' } })
  await app.register(helmet, { contentSecurityPolicy: false })
  await app.register(underPressure, { maxEventLoopDelay: 1000, maxEventLoopUtilization: 0.98 })

  app.get('/healthz', async () => ({
    status: 'ok',
    service: config.OTEL_SERVICE_NAME,
    kafka: 'connected',
  }))

  app.get('/metrics', async (_req, reply) => {
    reply.header('content-type', promRegister.contentType)
    return promRegister.metrics()
  })

  registerRoutes(app, redis)

  // ─── Shutdown ─────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<never> => {
    log.info({ signal }, 'shutting down')
    await app.close()
    await stopKafkaConsumer()
    await closeMongo()
    redis.disconnect()
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT',  () => void shutdown('SIGINT'))

  await app.listen({ port: config.PORT, host: '0.0.0.0' })
  log.info({ port: config.PORT }, 'Analytics service started')
}

void main().catch((err) => { log.error(err, 'startup failed'); process.exit(1) })
