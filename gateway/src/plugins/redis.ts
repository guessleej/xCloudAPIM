import fp from 'fastify-plugin'
import { Redis } from 'ioredis'
import { config } from '../config/index.js'
import type { FastifyPluginAsync } from 'fastify'

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
  })

  redis.on('error', (err) => fastify.log.error({ err }, 'redis error'))
  redis.on('connect', () => fastify.log.info('redis connected'))

  fastify.decorate('redis', redis)

  fastify.addHook('onClose', async () => {
    await redis.quit()
  })
}

export default fp(redisPlugin, { name: 'redis' })
