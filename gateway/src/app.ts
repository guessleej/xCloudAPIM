import https from 'node:https'
import { readFileSync } from 'node:fs'
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

    // ─── mTLS dual-listener（P3-3b-3；plain port 保留供 healthcheck/過渡）──
    if ((process.env['MTLS_ENABLED'] ?? '').toLowerCase() === 'true') {
      const dir = process.env['MTLS_CERT_DIR'] ?? '/etc/mtls'
      const mport = Number(process.env['MTLS_PORT'] ?? '9443')
      const mtlsServer = https.createServer({
        key:  readFileSync(`${dir}/service.key`),
        cert: readFileSync(`${dir}/service.crt`),
        ca:   readFileSync(`${dir}/ca.crt`),
        requestCert: true,
        rejectUnauthorized: true,
      }, server.routing)
      mtlsServer.listen(mport, '0.0.0.0', () =>
        server.log.info({ port: mport }, 'gateway mTLS listener started'))
    }
  } catch (err) {
    server.log.error(err, 'failed to start server')
    process.exit(1)
  }
}

void main()
