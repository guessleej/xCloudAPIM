import { initTracing, shutdownTracing } from './telemetry/tracing.js'
import { buildServer } from './server.js'
import { config } from './config/index.js'

// OpenTelemetry 必須在 require 之前初始化
initTracing()

async function main(): Promise<void> {
  const server = await buildServer()

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<never> => {
    server.log.info({ signal }, 'shutdown signal received')
    try {
      await server.close()
      await shutdownTracing()
      process.exit(0)
    } catch (err) {
      server.log.error(err, 'shutdown error')
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT',  () => void shutdown('SIGINT'))
  process.on('uncaughtException', (err) => {
    server.log.error(err, 'uncaught exception')
    process.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    server.log.error({ reason }, 'unhandled rejection')
    process.exit(1)
  })

  try {
    await server.listen({ port: config.PORT, host: '0.0.0.0' })
    server.log.info({ port: config.PORT, env: config.NODE_ENV }, 'gateway started')
  } catch (err) {
    server.log.error(err, 'failed to start server')
    process.exit(1)
  }
}

void main()
