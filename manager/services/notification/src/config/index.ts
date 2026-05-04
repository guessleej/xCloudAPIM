import { z } from 'zod'

const schema = z.object({
  PORT:     z.coerce.number().default(8086),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  KAFKA_BROKERS:   z.string().default('kafka:9092'),
  KAFKA_GROUP_ID:  z.string().default('notification-service'),
  KAFKA_CLIENT_ID: z.string().default('notification-service'),

  MONGO_URI: z.string().default('mongodb://apim_user:mongo_pass_dev@mongodb:27017/apim_analytics?authSource=admin'),
  MONGO_DB:  z.string().default('apim_analytics'),

  REDIS_HOST:     z.string().default('redis-master-1'),
  REDIS_PORT:     z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().default(''),
  REDIS_DB:       z.coerce.number().default(3),

  // SMTP
  SMTP_HOST:     z.string().default('mailhog'),
  SMTP_PORT:     z.coerce.number().default(1025),
  SMTP_SECURE:   z.string().transform((v) => v === 'true').default('false'),
  SMTP_USER:     z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM:     z.string().default('noreply@xcloudapim.local'),

  // Webhook retry
  WEBHOOK_MAX_RETRIES:     z.coerce.number().default(3),
  WEBHOOK_RETRY_BASE_MS:   z.coerce.number().default(1_000),
  WEBHOOK_TIMEOUT_MS:      z.coerce.number().default(10_000),

  // Notification log TTL（天）
  NOTIFICATION_TTL_DAYS:   z.coerce.number().default(90),

  OTEL_SERVICE_NAME: z.string().default('notification-service'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('❌ Notification invalid env:', parsed.error.format())
  process.exit(1)
}

export const config = parsed.data
