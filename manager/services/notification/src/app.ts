import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import { pino } from 'pino'
import { register as promRegister } from 'prom-client'
import { config } from './config/index.js'
import { connectMongo, closeMongo } from './store/mongodb.js'
import { startKafkaConsumer, stopKafkaConsumer } from './kafka/consumer.js'
import { registerRoutes } from './http/routes.js'

const log = pino({ level: config.NODE_ENV === 'production' ? 'info' : 'debug' })

async function main(): Promise<void> {
  await connectMongo(log)
  await startKafkaConsumer(log)

  const app = Fastify({ logger: { level: config.NODE_ENV === 'production' ? 'info' : 'debug' } })
  await app.register(helmet, { contentSecurityPolicy: false })

  app.get('/healthz', async () => ({ status: 'ok', service: config.OTEL_SERVICE_NAME }))
  app.get('/metrics', async (_req, reply) => {
    reply.header('content-type', promRegister.contentType)
    return promRegister.metrics()
  })

  registerRoutes(app)

  const shutdown = async (signal: string): Promise<never> => {
    log.info({ signal }, 'shutting down')
    await app.close()
    await stopKafkaConsumer()
    await closeMongo()
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT',  () => void shutdown('SIGINT'))

  await app.listen({ port: config.PORT, host: '0.0.0.0' })
  log.info({ port: config.PORT }, 'Notification service started')
}

void main().catch((err) => { log.error(err, 'startup failed'); process.exit(1) })
