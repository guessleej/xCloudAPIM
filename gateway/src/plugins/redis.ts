import { readFileSync } from 'node:fs'
import fp from 'fastify-plugin'
import { Redis } from 'ioredis'
import { config } from '../config/index.js'
import type { FastifyPluginAsync } from 'fastify'

// 有 Root CA 則驗證 redis 憑證鏈（verify-full，Phase 5）；否則 fallback skip-verify。
const redisTls = (() => {
  try {
    return { tls: { ca: [readFileSync(process.env['REDIS_CA'] ?? '/etc/pki/rootCA.crt')] } }
  } catch {
    return { tls: { rejectUnauthorized: false } }
  }
})()

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis
  }
}

const redisPlugin: FastifyPluginAsync = async (fastify) => {
  const redis = new Redis({
    host:     config.REDIS_HOST,
    port:     config.REDIS_PORT,
    password: config.REDIS_PASSWORD || undefined,
    db:       config.REDIS_DB,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    // REDIS_TLS=true 時以 TLS 連線（有 Root CA 則鏈驗證，Phase 5）
    ...(config.REDIS_TLS ? redisTls : {}),
  })

  redis.on('error', (err) => fastify.log.error({ err }, 'redis error'))
  redis.on('connect', () => fastify.log.info('redis connected'))

  fastify.decorate('redis', redis)

  fastify.addHook('onClose', async () => {
    await redis.quit()
  })
}

export default fp(redisPlugin, { name: 'redis' })
