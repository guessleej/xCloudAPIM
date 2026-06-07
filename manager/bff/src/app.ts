import https from 'node:https'
import { readFileSync } from 'node:fs'
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

  // ─── mTLS dual-listener（P3-3b-3；plain port 保留供 healthcheck/過渡）──
  if ((process.env['MTLS_ENABLED'] ?? '').toLowerCase() === 'true') {
    const dir = process.env['MTLS_CERT_DIR'] ?? '/etc/mtls'
    const mport = Number(process.env['MTLS_PORT'] ?? '9443')
    const handler = server.listeners('request')[0] as (req: unknown, res: unknown) => void
    const mtlsServer = https.createServer({
      key:  readFileSync(`${dir}/service.key`),
      cert: readFileSync(`${dir}/service.crt`),
      ca:   readFileSync(`${dir}/ca.crt`),
      requestCert: true,
      rejectUnauthorized: true,
    }, handler)
    mtlsServer.listen(mport, '0.0.0.0', () => log.info({ port: mport }, 'BFF mTLS listener started'))
  }
}

void main()
