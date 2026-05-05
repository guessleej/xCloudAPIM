/**
 * Notification REST API
 *
 * GET  /v1/notifications?orgId=&status=&page=&limit=
 * GET  /v1/notifications/:id
 * POST /v1/notifications/send   (手動觸發，供管理 UI 或測試使用)
 */
import type { FastifyInstance } from 'fastify'
import type { Logger } from 'pino'
import { getNotificationLogsCol } from '../store/mongodb.js'
import { sendEmail } from '../channels/email.js'
import { sendWebhook } from '../channels/webhook.js'
import { saveInApp } from '../channels/in-app.js'

export function registerRoutes(app: FastifyInstance): void {
  // ─── List ────────────────────────────────────────────────────
  app.get('/v1/notifications', async (req, reply) => {
    const { orgId, status, page = '1', limit = '20' } = req.query as Record<string, string>
    if (!orgId) return reply.code(400).send({ error: 'orgId required' })

    const filter: Record<string, unknown> = { orgId }
    if (status) filter['status'] = status

    const skip  = (parseInt(page, 10) - 1) * parseInt(limit, 10)
    const col   = getNotificationLogsCol()
    const total = await col.countDocuments(filter)
    const data  = await col.find(filter).sort({ ts: -1 }).skip(skip).limit(parseInt(limit, 10)).toArray()

    return reply.send({ data, total, page: parseInt(page, 10), limit: parseInt(limit, 10) })
  })

  // ─── Get one ─────────────────────────────────────────────────
  app.get('/v1/notifications/:id', async (req, reply) => {
    const { ObjectId } = await import('mongodb')
    const { id } = req.params as { id: string }
    try {
      const doc = await getNotificationLogsCol().findOne({ _id: new ObjectId(id) })
      if (!doc) return reply.code(404).send({ error: 'not found' })
      return reply.send(doc)
    } catch {
      return reply.code(400).send({ error: 'invalid id' })
    }
  })

  // ─── Manual send ─────────────────────────────────────────────
  app.post('/v1/notifications/send', async (req, reply) => {
    const body = req.body as {
      channel:    'email' | 'webhook' | 'in_app'
      eventType:  string
      recipient:  string
      orgId:      string
      data?:      Record<string, unknown>
      webhookSecret?: string
    }

    if (!body.channel || !body.eventType || !body.recipient || !body.orgId) {
      return reply.code(400).send({ error: 'channel, eventType, recipient, orgId required' })
    }

    const data = body.data ?? {}
    let result: { ok: boolean; error?: string }

    if (body.channel === 'email') {
      result = await sendEmail(body.recipient, body.eventType, data, req.log as unknown as Logger)
    } else if (body.channel === 'webhook') {
      result = await sendWebhook(body.recipient, body.eventType, data, req.log as unknown as Logger, body.webhookSecret)
    } else {
      await saveInApp(body.orgId, body.eventType, data)
      result = { ok: true }
    }

    return reply.code(result.ok ? 200 : 500).send(result)
  })
}
