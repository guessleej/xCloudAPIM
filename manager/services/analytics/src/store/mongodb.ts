/**
 * MongoDB 連線 + Collection 定義
 *
 * Collections:
 *   api_events        — 原始請求事件（TTL: RAW_EVENT_TTL_DAYS）
 *   metrics_hourly    — 小時級彙整（保留 90 天）
 *   metrics_daily     — 日級彙整（永久保留）
 */
import { MongoClient, type Db, type Collection } from 'mongodb'
import type { Logger } from 'pino'
import { config } from '../config/index.js'

export interface ApiEvent {
  _id?:          unknown
  traceId:       string
  apiId:         string
  clientId:      string
  userId:        string
  plan:          string
  method:        string
  path:          string
  statusCode:    number
  latencyMs:     number
  requestBytes:  number
  responseBytes: number
  isError:       boolean
  errorCode?:    string
  ts:            Date        // 事件時間（TTL index on this field）
}

export interface MetricBucket {
  _id?:          unknown
  bucketStart:   Date
  bucketType:    'hour' | 'day'
  apiId:         string
  clientId:      string
  plan:          string
  requests:      number
  errors:        number
  latencySum:    number
  latencyMax:    number
  latencyP99:    number      // 估算（t-digest 等，此處用排序 sample 近似）
  bytes2xx:      number
  bytes4xx:      number
  bytes5xx:      number
  statusCounts:  Record<string, number>
}

export interface QuotaEvent {
  _id?:      unknown
  apiId:     string
  clientId:  string
  plan:      string
  window:    string   // 'rpm' | 'rph' | 'rpd'
  limit:     number
  actual:    number
  ts:        Date
}

let client: MongoClient
let db: Db

export async function connectMongo(log: Logger): Promise<Db> {
  client = new MongoClient(config.MONGO_URI, {
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS:         5_000,
  })
  await client.connect()
  db = client.db(config.MONGO_DB)
  await ensureIndexes(db, log)
  log.info('MongoDB connected')
  return db
}

export async function closeMongo(): Promise<void> {
  await client?.close()
}

export function getDb(): Db { return db }

export function getApiEventsCol(): Collection<ApiEvent> {
  return db.collection<ApiEvent>('api_events')
}

export function getMetricsHourlyCol(): Collection<MetricBucket> {
  return db.collection<MetricBucket>('metrics_hourly')
}

export function getMetricsDailyCol(): Collection<MetricBucket> {
  return db.collection<MetricBucket>('metrics_daily')
}

export function getQuotaEventsCol(): Collection<QuotaEvent> {
  return db.collection<QuotaEvent>('quota_events')
}

async function ensureIndexes(db: Db, log: Logger): Promise<void> {
  const ttlSec = config.RAW_EVENT_TTL_DAYS * 86400

  await db.collection('api_events').createIndexes([
    { key: { ts: 1 }, expireAfterSeconds: ttlSec, name: 'ttl_ts' },
    { key: { apiId: 1, ts: -1 },            name: 'apiId_ts' },
    { key: { clientId: 1, ts: -1 },         name: 'clientId_ts' },
    { key: { apiId: 1, clientId: 1, ts: -1 }, name: 'api_client_ts' },
  ])

  await db.collection('metrics_hourly').createIndexes([
    { key: { ts: 1 }, expireAfterSeconds: 90 * 86400, name: 'ttl_90d' },
    { key: { bucketStart: -1, apiId: 1 }, name: 'bucket_api' },
    { key: { bucketStart: -1, apiId: 1, clientId: 1 }, name: 'bucket_api_client', unique: true },
  ])

  await db.collection('metrics_daily').createIndexes([
    { key: { bucketStart: -1, apiId: 1 }, name: 'bucket_api' },
    { key: { bucketStart: -1, apiId: 1, clientId: 1 }, name: 'bucket_api_client', unique: true },
  ])

  await db.collection('quota_events').createIndexes([
    { key: { ts: 1 }, expireAfterSeconds: 30 * 86400, name: 'ttl_30d' },
    { key: { apiId: 1, ts: -1 }, name: 'apiId_ts' },
  ])

  log.info('MongoDB indexes ensured')
}
