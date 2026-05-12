import { z } from 'zod'

const schema = z.object({
  PORT:                     z.coerce.number().default(8080),
  NODE_ENV:                 z.enum(['development', 'production', 'test']).default('development'),

  REDIS_HOST:               z.string().default('localhost'),
  REDIS_PORT:               z.coerce.number().default(6379),
  REDIS_PASSWORD:           z.string().default(''),
  REDIS_DB:                 z.coerce.number().default(0),

  AUTH_SERVICE_URL:         z.string().url().default('http://auth-service:8081'),
  REGISTRY_SERVICE_URL:     z.string().url().default('http://registry-service:8082'),
  SUBSCRIPTION_SERVICE_URL: z.string().url().default('http://subscription-service:8084'),
  POLICY_ENGINE_URL:        z.string().url().default('http://policy-engine:8083'),

  JWKS_URL:                 z.string().url().default('http://auth-service:8081/oauth2/jwks'),
  JWKS_CACHE_TTL_MS:        z.coerce.number().default(300_000),

  ROUTE_REFRESH_INTERVAL_MS: z.coerce.number().default(30_000),
  ROUTE_CACHE_TTL_S:         z.coerce.number().default(300),

  PROXY_TIMEOUT_MS:          z.coerce.number().default(30_000),
  PROXY_KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().default(60_000),
  MAX_BODY_SIZE_MB:          z.coerce.number().default(10),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://localhost:4318'),
  OTEL_SERVICE_NAME:           z.string().default('api-gateway'),

  INTERNAL_SERVICE_SECRET:     z.string().min(1).default(''),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('❌ Invalid environment variables:')
  console.error(parsed.error.format())
  process.exit(1)
}

export const config = parsed.data
export type Config = typeof config
