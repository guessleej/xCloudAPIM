/**
 * MongoDB — Notification log
 *
 * Collection: notification_logs
 *   channel:     'email' | 'webhook' | 'in_app'
 *   eventType:   'quota_exceeded' | 'subscription_expiry' | 'api_key_revoked' |
 *                'subscription_activated' | 'subscription_cancelled' | 'custom'
 *   recipient:   email / webhook URL / user_id
 *   status:      'pending' | 'sent' | 'failed' | 'skipped'
 *   attempts:    number
 *   payload:     JSON（原始 Kafka 訊息）
 *   error:       最後一次錯誤訊息
 *   ts:          發送時間（TTL index）
 */
import { MongoClient, type Db, type Collection } from 'mongodb'
import type { Logger } from 'pino'
import { config } from '../config/index.js'

export interface NotificationLog {
  _id?:       unknown
  channel:    'email' | 'webhook' | 'in_app'
  eventType:  string
  recipient:  string
  orgId:      string
  apiId?:     string
  subject?:   string
  status:     'pending' | 'sent' | 'failed' | 'skipped'
  attempts:   number
  payload:    Record<string, unknown>
  error?:     string
  ts:         Date
}

let client: MongoClient
let db: Db

export async function connectMongo(log: Logger): Promise<Db> {
  client = new MongoClient(config.MONGO_URI, { serverSelectionTimeoutMS: 5_000 })
  await client.connect()
  db = client.db(config.MONGO_DB)
  await ensureIndexes(db)
  log.info('MongoDB connected (notification)')
  return db
}

export async function closeMongo(): Promise<void> {
  await client?.close()
}

export function getNotificationLogsCol(): Collection<NotificationLog> {
  return db.collection<NotificationLog>('notification_logs')
}

async function ensureIndexes(db: Db): Promise<void> {
  const ttlSec = config.NOTIFICATION_TTL_DAYS * 86400
  await db.collection('notification_logs').createIndexes([
    { key: { ts: 1 },              expireAfterSeconds: ttlSec, name: 'ttl_ts' },
    { key: { orgId: 1, ts: -1 },   name: 'orgId_ts' },
    { key: { status: 1, ts: -1 },  name: 'status_ts' },
    { key: { eventType: 1, ts: -1 }, name: 'eventType_ts' },
  ])
}
