/**
 * Kafka Consumer — 訂閱 notification.send + quota.exceeded + auth.events
 *
 * notification.send 訊息格式：
 * {
 *   eventType:  'quota_exceeded' | 'subscription_expiry' | 'api_key_revoked' | ...
 *   channels:   ['email', 'webhook', 'in_app']
 *   recipient:  { email?: string, webhookUrl?: string, webhookSecret?: string, orgId: string }
 *   data:       { ... eventType-specific fields ... }
 * }
 */
import { Kafka, type Consumer, logLevel } from 'kafkajs'
import type { Logger } from 'pino'
import { config } from '../config/index.js'
import { getNotificationLogsCol } from '../store/mongodb.js'
import { sendEmail } from '../channels/email.js'
import { sendWebhook } from '../channels/webhook.js'
import { saveInApp } from '../channels/in-app.js'

let consumer: Consumer

export interface NotificationMessage {
  eventType: string
  channels:  Array<'email' | 'webhook' | 'in_app'>
  recipient: {
    email?:         string
    webhookUrl?:    string
    webhookSecret?: string
    orgId:          string
  }
  data:      Record<string, unknown>
}

export async function startKafkaConsumer(log: Logger): Promise<void> {
  const kafka = new Kafka({
    clientId: config.KAFKA_CLIENT_ID,
    brokers:  config.KAFKA_BROKERS.split(','),
    logLevel: logLevel.WARN,
  })

  consumer = kafka.consumer({ groupId: config.KAFKA_GROUP_ID })
  await consumer.connect()
  await consumer.subscribe({
    topics: ['notification.send', 'quota.exceeded', 'auth.events'],
    fromBeginning: false,
  })

  log.info('Notification Kafka consumer started')

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      if (!message.value) return
      try {
        const raw = JSON.parse(message.value.toString()) as Record<string, unknown>

        let msg: NotificationMessage
        if (topic === 'quota.exceeded') {
          // quota.exceeded 自動轉為 email + in_app 通知
          msg = {
            eventType: 'quota_exceeded',
            channels:  ['email', 'in_app'],
            recipient: {
              email: raw['contactEmail'] as string | undefined,
              orgId: String(raw['orgId'] ?? raw['org_id'] ?? ''),
            },
            data: raw,
          }
        } else if (topic === 'auth.events') {
          if (raw['event'] !== 'api_key.revoked') return
          msg = {
            eventType: 'api_key_revoked',
            channels:  ['email', 'in_app'],
            recipient: {
              email: raw['contactEmail'] as string | undefined,
              orgId: String(raw['orgId'] ?? ''),
            },
            data: raw,
          }
        } else {
          msg = raw as unknown as NotificationMessage
        }

        await dispatch(msg, log)
      } catch (err) {
        log.warn({ err, topic }, 'failed to process notification message')
      }
    },
  })
}

export async function stopKafkaConsumer(): Promise<void> {
  await consumer?.disconnect()
}

// ─── Dispatcher ───────────────────────────────────────────────

async function dispatch(msg: NotificationMessage, log: Logger): Promise<void> {
  const channels = msg.channels ?? []

  for (const channel of channels) {
    const logEntry = {
      channel,
      eventType: msg.eventType,
      recipient: channel === 'email' ? (msg.recipient.email ?? '') : (msg.recipient.webhookUrl ?? msg.recipient.orgId),
      orgId:     msg.recipient.orgId,
      apiId:     msg.data['apiId'] as string | undefined,
      status:    'pending' as const,
      attempts:  0,
      payload:   msg.data,
      ts:        new Date(),
    }

    const col = getNotificationLogsCol()
    const { insertedId } = await col.insertOne(logEntry)

    let result: { ok: boolean; error?: string }

    if (channel === 'email') {
      if (!msg.recipient.email) {
        await col.updateOne({ _id: insertedId }, { $set: { status: 'skipped', error: 'no email recipient' } })
        continue
      }
      result = await sendEmail(msg.recipient.email, msg.eventType, msg.data, log)
    } else if (channel === 'webhook') {
      if (!msg.recipient.webhookUrl) {
        await col.updateOne({ _id: insertedId }, { $set: { status: 'skipped', error: 'no webhook url' } })
        continue
      }
      result = await sendWebhook(msg.recipient.webhookUrl, msg.eventType, msg.data, log, msg.recipient.webhookSecret)
    } else {
      await saveInApp(msg.recipient.orgId, msg.eventType, msg.data)
      result = { ok: true }
    }

    await col.updateOne(
      { _id: insertedId },
      {
        $set: {
          status:   result.ok ? 'sent' : 'failed',
          attempts: 1,
          error:    result.error,
        },
      },
    )
  }
}
