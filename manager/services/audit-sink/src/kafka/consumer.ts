import { Kafka, logLevel, type Consumer } from 'kafkajs'
import type { Logger } from 'pino'
import { config } from '../config/index.js'
import { appendAudit } from '../store/pg.js'

let consumer: Consumer

export async function startKafkaConsumer(log: Logger): Promise<void> {
  const kafka = new Kafka({
    clientId: config.KAFKA_CLIENT_ID,
    brokers:  config.KAFKA_BROKERS.split(','),
    logLevel: logLevel.WARN,
    // KAFKA_SASL_USERNAME 設定時走 SASL_SSL（自簽憑證 → 不驗證 CA）
    ...(config.KAFKA_SASL_USERNAME ? {
      ssl:  { rejectUnauthorized: false },
      sasl: { mechanism: 'plain' as const, username: config.KAFKA_SASL_USERNAME, password: config.KAFKA_SASL_PASSWORD },
    } : {}),
  })

  consumer = kafka.consumer({ groupId: config.KAFKA_GROUP_ID })
  await consumer.connect()

  const topics = config.AUDIT_TOPICS.split(',').map((t) => t.trim()).filter(Boolean)
  for (const t of topics) {
    await consumer.subscribe({ topic: t, fromBeginning: false })
  }
  log.info({ topics }, 'Audit Kafka consumer started')

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      if (!message.value) return
      let payload: unknown
      try {
        payload = JSON.parse(message.value.toString())
      } catch {
        payload = { raw: message.value.toString() }
      }
      const p = (payload ?? {}) as Record<string, unknown>
      const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
      try {
        await appendAudit({
          topic,
          eventType: str(p['event_type']) ?? str(p['type']) ?? str(p['event']),
          actor:     str(p['actor']) ?? str(p['user_id']) ?? str(p['org_id']),
          sourceIp:  str(p['ip']) ?? str(p['source_ip']),
          payload,
        })
      } catch (err) {
        log.error({ err, topic }, 'audit append failed')
      }
    },
  })
}

export async function stopKafkaConsumer(): Promise<void> {
  await consumer?.disconnect()
}
