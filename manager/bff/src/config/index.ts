import { z } from 'zod'

const schema = z.object({
  PORT:                     z.coerce.number().default(4000),
  NODE_ENV:                 z.enum(['development', 'production', 'test']).default('development'),

  // 後端服務 URL
  AUTH_SERVICE_URL:         z.string().url().default('http://auth-service:8081'),
  REGISTRY_SERVICE_URL:     z.string().url().default('http://registry-service:8082'),
  POLICY_ENGINE_URL:        z.string().url().default('http://policy-engine:8083'),
  SUBSCRIPTION_SERVICE_URL: z.string().url().default('http://subscription-service:8084'),

  // JWT 驗證（BFF 本身驗簽 admin JWT）
  JWKS_URL:                 z.string().url().default('http://auth-service:8081/oauth2/jwks'),
  JWKS_CACHE_TTL_MS:        z.coerce.number().default(300_000),
  JWT_ISSUER:               z.string().default(''),
  JWT_AUDIENCE:             z.string().default(''),

  // GraphQL
  GRAPHQL_PATH:             z.string().default('/graphql'),
  GRAPHQL_MAX_DEPTH:        z.coerce.number().default(10),
  GRAPHQL_MAX_COMPLEXITY:   z.coerce.number().default(200),
  INTROSPECTION_ENABLED:    z.string().transform((v) => v === 'true').default('false'),

  // HTTP client
  UPSTREAM_TIMEOUT_MS:      z.coerce.number().default(10_000),

  // Redis（query result cache）
  REDIS_HOST:               z.string().default('redis-master-1'),
  REDIS_PORT:               z.coerce.number().default(6379),
  REDIS_PASSWORD:           z.string().default(''),
  REDIS_DB:                 z.coerce.number().default(1),   // DB 1，與 gateway DB 0 隔離

  // OTel
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://jaeger:4318'),
  OTEL_SERVICE_NAME:           z.string().default('bff'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('❌ BFF invalid environment variables:')
  console.error(parsed.error.format())
  process.exit(1)
}

export const config = parsed.data
export type Config = typeof config
