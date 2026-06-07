import { z } from 'zod'

const schema = z.object({
  PORT:     z.coerce.number().default(8087),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  KAFKA_BROKERS:       z.string().default('kafka:9092'),
  KAFKA_GROUP_ID:      z.string().default('audit-sink'),
  KAFKA_CLIENT_ID:     z.string().default('audit-sink'),
  KAFKA_SASL_USERNAME: z.string().default(''),
  KAFKA_SASL_PASSWORD: z.string().default(''),
  // 要稽核的 topics（逗號分隔）
  AUDIT_TOPICS: z.string().default('auth.events,policy.published,subscription.events'),

  POSTGRES_HOST:     z.string().default('postgres'),
  POSTGRES_PORT:     z.coerce.number().default(5432),
  POSTGRES_USER:     z.string().default('apim_user'),
  POSTGRES_PASSWORD: z.string().default(''),
  POSTGRES_DB:       z.string().default('apim'),
  POSTGRES_SSL_MODE: z.string().default('require'),

  OTEL_SERVICE_NAME: z.string().default('audit-sink'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('❌ audit-sink invalid env:', parsed.error.format())
  process.exit(1)
}

export const config = parsed.data
