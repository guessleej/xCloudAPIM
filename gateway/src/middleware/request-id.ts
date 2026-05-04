import fp from 'fastify-plugin'
import { v4 as uuidv4 } from 'uuid'
import type { FastifyPluginAsync } from 'fastify'

const requestIdPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request, reply) => {
    const traceId = (request.headers['x-trace-id'] as string)
      ?? (request.headers['x-request-id'] as string)
      ?? uuidv4()

    request.headers['x-trace-id']   = traceId
    request.headers['x-request-id'] = traceId
    reply.header('x-trace-id',   traceId)
    reply.header('x-request-id', traceId)

    // 在 request 物件上暴露給後續中介層使用
    ;(request as unknown as { traceId: string }).traceId = traceId
  })
}

export default fp(requestIdPlugin, { name: 'request-id' })
