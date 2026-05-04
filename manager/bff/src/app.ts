import { pino } from 'pino'
import { buildServer } from './server.js'
import { config } from './config/index.js'

const log = pino({
  level: config.NODE_ENV === 'production' ? 'info' : 'debug',
  ...(config.NODE_ENV !== 'production'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
})

async function main(): Promise<void> {
  const server = await buildServer(log)

  const shutdown = async (signal: string): Promise<never> => {
    log.info({ signal }, 'shutdown signal received')
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 10_000).unref()
    return new Promise(() => {})
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT',  () => void shutdown('SIGINT'))
  process.on('uncaughtException', (err) => { log.error(err, 'uncaught exception'); process.exit(1) })
  process.on('unhandledRejection', (reason) => { log.error({ reason }, 'unhandled rejection'); process.exit(1) })

  server.listen(config.PORT, '0.0.0.0', () => {
    log.info(
      { port: config.PORT, path: config.GRAPHQL_PATH, env: config.NODE_ENV },
      'BFF GraphQL server started',
    )
  })
}

void main()
