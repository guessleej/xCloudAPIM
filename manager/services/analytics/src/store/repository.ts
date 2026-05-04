/**
 * Analytics Repository — 查詢彙整統計
 */
import type { Sort } from 'mongodb'
import {
  getApiEventsCol, getMetricsHourlyCol, getMetricsDailyCol, getQuotaEventsCol,
  type ApiEvent, type MetricBucket,
} from './mongodb.js'

// ─── 寫入 ─────────────────────────────────────────────────────

export async function insertApiEvent(event: Omit<ApiEvent, '_id'>): Promise<void> {
  await getApiEventsCol().insertOne(event as ApiEvent)
}

export async function upsertHourlyBucket(
  bucketStart: Date,
  apiId: string,
  clientId: string,
  plan: string,
  event: { latencyMs: number; statusCode: number; isError: boolean; responseBytes: number },
): Promise<void> {
  const statusKey = String(event.statusCode)
  await getMetricsHourlyCol().updateOne(
    { bucketStart, apiId, clientId, bucketType: 'hour' },
    {
      $inc: {
        requests:                      1,
        errors:                        event.isError ? 1 : 0,
        latencySum:                    event.latencyMs,
        [`statusCounts.${statusKey}`]: 1,
        bytes2xx: event.statusCode >= 200 && event.statusCode < 300 ? event.responseBytes : 0,
        bytes4xx: event.statusCode >= 400 && event.statusCode < 500 ? event.responseBytes : 0,
        bytes5xx: event.statusCode >= 500 ? event.responseBytes : 0,
      },
      $max: { latencyMax: event.latencyMs },
      $set: { plan, bucketType: 'hour' },
      $setOnInsert: { latencyP99: 0 },
    },
    { upsert: true },
  )
}

export async function upsertDailyBucket(
  bucketStart: Date,
  apiId: string,
  clientId: string,
  plan: string,
  event: { latencyMs: number; statusCode: number; isError: boolean; responseBytes: number },
): Promise<void> {
  const statusKey = String(event.statusCode)
  await getMetricsDailyCol().updateOne(
    { bucketStart, apiId, clientId, bucketType: 'day' },
    {
      $inc: {
        requests:                      1,
        errors:                        event.isError ? 1 : 0,
        latencySum:                    event.latencyMs,
        [`statusCounts.${statusKey}`]: 1,
        bytes2xx: event.statusCode >= 200 && event.statusCode < 300 ? event.responseBytes : 0,
        bytes4xx: event.statusCode >= 400 && event.statusCode < 500 ? event.responseBytes : 0,
        bytes5xx: event.statusCode >= 500 ? event.responseBytes : 0,
      },
      $max: { latencyMax: event.latencyMs },
      $set: { plan, bucketType: 'day' },
      $setOnInsert: { latencyP99: 0 },
    },
    { upsert: true },
  )
}

// ─── 查詢 ─────────────────────────────────────────────────────

export interface MetricsSummary {
  apiId:          string
  period:         string
  totalRequests:  number
  errorRequests:  number
  errorRate:      number
  avgLatencyMs:   number
  maxLatencyMs:   number
  totalBytes:     number
  topStatusCodes: Array<{ statusCode: number; count: number }>
}

/** 指定 API 在指定時間範圍內的彙整統計 */
export async function getAPISummary(
  apiId:   string,
  from:    Date,
  to:      Date,
  granularity: 'hour' | 'day' = 'hour',
): Promise<MetricsSummary> {
  const col = granularity === 'hour' ? getMetricsHourlyCol() : getMetricsDailyCol()

  const agg = await col.aggregate<{
    totalRequests: number; errors: number; latencySum: number; latencyMax: number
    bytes2xx: number; bytes4xx: number; bytes5xx: number
    statusCounts: Record<string, number>
  }>([
    { $match: { apiId, bucketStart: { $gte: from, $lte: to } } },
    {
      $group: {
        _id:          null,
        totalRequests: { $sum: '$requests' },
        errors:        { $sum: '$errors' },
        latencySum:    { $sum: '$latencySum' },
        latencyMax:    { $max: '$latencyMax' },
        bytes2xx:      { $sum: '$bytes2xx' },
        bytes4xx:      { $sum: '$bytes4xx' },
        bytes5xx:      { $sum: '$bytes5xx' },
        statusCounts:  { $mergeObjects: '$statusCounts' },
      },
    },
  ]).toArray()

  const r = agg[0]
  if (!r || r.totalRequests === 0) {
    return { apiId, period: `${from.toISOString()}/${to.toISOString()}`, totalRequests: 0, errorRequests: 0, errorRate: 0, avgLatencyMs: 0, maxLatencyMs: 0, totalBytes: 0, topStatusCodes: [] }
  }

  const topStatusCodes = Object.entries(r.statusCounts ?? {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([code, count]) => ({ statusCode: parseInt(code, 10), count }))

  return {
    apiId,
    period:         `${from.toISOString()}/${to.toISOString()}`,
    totalRequests:  r.totalRequests,
    errorRequests:  r.errors,
    errorRate:      r.totalRequests ? r.errors / r.totalRequests : 0,
    avgLatencyMs:   r.totalRequests ? r.latencySum / r.totalRequests : 0,
    maxLatencyMs:   r.latencyMax,
    totalBytes:     r.bytes2xx + r.bytes4xx + r.bytes5xx,
    topStatusCodes,
  }
}

/** 時間序列（每個 bucket 一個資料點）*/
export async function getTimeSeries(
  apiId:       string,
  clientId:    string | undefined,
  from:        Date,
  to:          Date,
  granularity: 'hour' | 'day',
): Promise<MetricBucket[]> {
  const col = granularity === 'hour' ? getMetricsHourlyCol() : getMetricsDailyCol()
  const filter: Record<string, unknown> = { apiId, bucketStart: { $gte: from, $lte: to } }
  if (clientId) filter['clientId'] = clientId
  const sort: Sort = { bucketStart: 1 }
  return col.find(filter).sort(sort).limit(1000).toArray() as unknown as MetricBucket[]
}

/** Top clients for an API */
export async function getTopClients(
  apiId: string,
  from:  Date,
  to:    Date,
  limit = 10,
): Promise<Array<{ clientId: string; requests: number; errors: number }>> {
  return getMetricsHourlyCol().aggregate<{ clientId: string; requests: number; errors: number }>([
    { $match: { apiId, bucketStart: { $gte: from, $lte: to } } },
    { $group: { _id: '$clientId', requests: { $sum: '$requests' }, errors: { $sum: '$errors' } } },
    { $project: { _id: 0, clientId: '$_id', requests: 1, errors: 1 } },
    { $sort: { requests: -1 } },
    { $limit: limit },
  ]).toArray()
}

/** 配額超限事件列表 */
export async function getQuotaEvents(apiId: string, from: Date, to: Date): Promise<unknown[]> {
  return getQuotaEventsCol()
    .find({ apiId, ts: { $gte: from, $lte: to } })
    .sort({ ts: -1 })
    .limit(200)
    .toArray()
}
