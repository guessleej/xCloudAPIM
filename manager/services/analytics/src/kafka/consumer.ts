/**
 * Kafka Consumer
 * Topics:
 *   api.requests   — { traceId, apiId, clientId, userId, plan, method, path,
 *                      statusCode, latencyMs, requestBytes, responseBytes, ts }
 *   api.errors     — 同上，isError=true
 *   quota.exceeded — { apiId, clientId, plan, window, limit, actual, ts }
 */
import { Kafka, type Consumer, logLevel } from 'kafkajs'
import type { Redis } from 'ioredis'
import type { Logger } from 'pino'
import { config } from '../config/index.js'
import {
  insertApiEvent, upsertHourlyBucket, upsertDailyBucket,
} from '../store/repository.js'
import { getQuotaEventsCol } from '../store/mongodb.js'
import { incrRealtimeCounters } from '../aggregator/realtime.js'

let consumer: Consumer

export async function startKafkaConsumer(redis: Redis, log: Logger): Promise<void> {
  const kafka = new Kafka({
    clientId: config.KAFKA_CLIENT_ID,
    brokers:  config.KAFKA_BROKERS.split(','),
    logLevel: logLevel.WARN,
  })

  consumer = kafka.consumer({ groupId: config.KAFKA_GROUP_ID })
  await consumer.connect()
  await consumer.subscribe({ topics: ['api.requests', 'api.errors', 'quota.exceeded'], fromBeginning: false })

  log.info('Kafka consumer connected, subscribing to api.requests / api.errors / quota.exceeded')

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      if (!message.value) return
      try {
        const payload = JSON.parse(message.value.toString()) as Record<string, unknown>

        if (topic === 'quota.exceeded') {
          await handleQuotaEvent(payload)
          return
        }

        await handleApiEvent(payload, topic === 'api.errors', redis, log)
      } catch (err) {
        log.warn({ err, topic }, 'failed to process kafka message')
      }
    },
  })
}

export async function stopKafkaConsumer(): Promise<void> {
  await consumer?.disconnect()
}

// ─── Handlers ─────────────────────────────────────────────────

async function handleApiEvent(
  payload: Record<string, unknown>,
  forceError: boolean,
  redis: Redis,
  log: Logger,
): Promise<void> {
  const ts          = payload['ts'] ? new Date(payload['ts'] as string) : new Date()
  const apiId       = String(payload['apiId']       ?? payload['api_id']       ?? '')
  const clientId    = String(payload['clientId']    ?? payload['client_id']    ?? '')
  const userId      = String(payload['userId']      ?? payload['user_id']      ?? '')
  const plan        = String(payload['plan']        ?? '')
  const method      = String(payload['method']      ?? 'UNKNOWN')
  const path        = String(payload['path']        ?? '/')
  const statusCode  = parseInt(String(payload['statusCode'] ?? payload['status_code'] ?? '0'), 10)
  const latencyMs   = parseInt(String(payload['latencyMs']  ?? payload['latency_ms']  ?? '0'), 10)
  const reqBytes    = parseInt(String(payload['requestBytes']  ?? '0'), 10)
  const resBytes    = parseInt(String(payload['responseBytes'] ?? '0'), 10)
  const isError     = forceError || statusCode >= 500

  if (!apiId) { log.debug({ payload }, 'api event missing apiId'); return }

  // 原始事件寫入 MongoDB
  await insertApiEvent({ traceId: String(payload['traceId'] ?? ''), apiId, clientId, userId, plan, method, path, statusCode, latencyMs, requestBytes: reqBytes, responseBytes: resBytes, isError, ts })

  // 小時 / 日 bucket upsert
  const hourStart = new Date(ts)
  hourStart.setMinutes(0, 0, 0)
  const dayStart = new Date(ts)
  dayStart.setHours(0, 0, 0, 0)

  const ev = { latencyMs, statusCode, isError, responseBytes: resBytes }
  await Promise.all([
    upsertHourlyBucket(hourStart, apiId, clientId, plan, ev),
    upsertDailyBucket(dayStart, apiId, clientId, plan, ev),
    incrRealtimeCounters(redis, apiId, clientId, isError),
  ])
}

async function handleQuotaEvent(payload: Record<string, unknown>): Promise<void> {
  await getQuotaEventsCol().insertOne({
    apiId:    String(payload['apiId']    ?? payload['api_id']    ?? ''),
    clientId: String(payload['clientId'] ?? payload['client_id'] ?? ''),
    plan:     String(payload['plan']     ?? ''),
    window:   String(payload['window']   ?? 'rpm'),
    limit:    parseInt(String(payload['limit']  ?? '0'), 10),
    actual:   parseInt(String(payload['actual'] ?? '0'), 10),
    ts:       payload['ts'] ? new Date(payload['ts'] as string) : new Date(),
  })
}
