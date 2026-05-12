import { z } from 'zod'

const schema = z.object({
  PORT:     z.coerce.number().default(8085),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  KAFKA_BROKERS:       z.string().default('kafka:9092'),
  KAFKA_GROUP_ID:      z.string().default('analytics-service'),
  KAFKA_CLIENT_ID:     z.string().default('analytics-service'),

  MONGO_URI:           z.string().url(),
  MONGO_DB:            z.string().default('apim_analytics'),

  REDIS_HOST:          z.string().default('redis-master-1'),
  REDIS_PORT:          z.coerce.number().default(6379),
  REDIS_PASSWORD:      z.string().default(''),
  REDIS_DB:            z.coerce.number().default(2),

  // 即時統計 TTL（分鐘）
  REALTIME_WINDOW_MIN: z.coerce.number().default(60),

  // 保留原始事件天數（MongoDB TTL index）
  RAW_EVENT_TTL_DAYS:  z.coerce.number().default(30),

  OTEL_SERVICE_NAME:   z.string().default('analytics-service'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('❌ Analytics invalid env:', parsed.error.format())
  process.exit(1)
}

export const config = parsed.data
