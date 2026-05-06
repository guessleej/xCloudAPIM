# xCloudAPIM — 全系統路由串接圖

> 本文件描述從外部請求進入系統直到各微服務的完整路由路徑。
> 自動掃描來源：所有 router.go / routes.ts / apim.conf / server.ts。

---

## 一、整體架構流向

```
外部 Client
    │
    ▼ :80 / :443 / :19000(dev)
┌─────────────┐
│    Nginx    │  (反向代理 + 速率限制 + TLS 終止)
└──────┬──────┘
       │ 依 Host / Path 分流
       ├─────────────────────────────────────┐
       │ (default / portal.apim.local)       │ (api.apim.local)
       ▼                                     ▼
┌─────────────┐                    ┌──────────────────┐
│   Portal    │ Next.js :3001      │    Gateway       │ Fastify :8080
│             │                    │                  │
│  UI Pages   │                    │ ① 路由比對       │
│  API Routes │                    │ ② Plugin Pipeline│
│  /graphql   │──→ BFF :4000       │ ③ 上游代理      │
└─────────────┘                    └────────┬─────────┘
                                            │
       ┌─────────────────────────────┬──────┴──────────────┐
       ▼                             ▼                      ▼
┌─────────────┐             ┌──────────────┐      ┌─────────────────┐
│ BFF GraphQL │ Apollo:4000 │ Auth Service │      │Registry Service │
│  (bff.apim  │             │    :8081     │      │     :8082       │
│  .local)    │             └──────────────┘      └─────────────────┘
└──────┬──────┘
       │ DataSources
       ├────────────────────────────────────┐
       ▼                                    ▼
┌──────────────┐                   ┌──────────────────┐
│  Registry    │                   │  Subscription    │
│  :8082       │                   │  :8084           │
└──────────────┘                   └──────────────────┘

其他服務 (Gateway 可代理):
  Analytics Service   :8085
  Notification Service :8086
  Policy Engine       :8083  (placeholder，未實作)
```

---

## 二、Nginx 路由規則

**設定檔：** `infra/nginx/conf.d/apim.conf`

| Host / 條件 | 對應上游 | 速率限制 | 備註 |
|---|---|---|---|
| `localhost` / 任何 Host (default) | `portal:3001` | 30 r/s burst 60 | 開發者入口 |
| `portal.apim.local` | `portal:3001` | 30 r/s burst 60 | — |
| `api.apim.local` | `gateway:8080` | 100 r/s burst 200 | API 閘道 |
| `bff.apim.local /graphql` | `bff:4000/graphql` | — | GraphQL (含 WS) |
| `studio.apim.local /` | `studio:80` | — | Policy Studio UI |
| `studio.apim.local /graphql` | `bff:4000/graphql` | — | Studio 呼叫 BFF |
| `grafana.apim.local` | `grafana:3000` | — | Basic Auth 保護 |
| `kibana.apim.local` | `kibana:5601` | — | Basic Auth 保護 |
| `jaeger.apim.local` | `jaeger:16686` | — | Basic Auth 保護 |
| `:8888/nginx_status` | stub_status | 僅限 172.28.0.0/16 | Prometheus 採集 |

**外部 Port 對應：**
- 開發環境：`:19000` → Nginx :80
- 生產環境：`:80` / `:443` → Nginx（TLS 終止在 `infra/nginx/conf.d/ssl.conf`）

---

## 三、Portal（Next.js App Router）

**服務：** `portal:3001` | **原始碼：** `portal/src/app/`

### 3.1 頁面路由（Server Components）

| URL 路徑 | 頁面檔案 | 說明 |
|---|---|---|
| `/` | `app/page.tsx` | 首頁 |
| `/docs` | `app/docs/page.tsx` | 開發者文件中心 |
| `/auth/login` | `app/auth/login/page.tsx` | 登入頁 |
| `/auth/register` | `app/auth/register/page.tsx` | 註冊頁 |
| `/(auth)/login` | `app/(auth)/login/page.tsx` | 登入（群組路由） |
| `/(auth)/register` | `app/(auth)/register/page.tsx` | 註冊（群組路由） |
| `/(public)/apis` | `app/(public)/apis/page.tsx` | API 目錄列表 |
| `/(public)/apis/[id]` | `app/(public)/apis/[id]/page.tsx` | API 詳情 |
| `/(public)/apis/[id]/docs` | `app/(public)/apis/[id]/docs/page.tsx` | API 文件（OpenAPI） |
| `/dashboard` | `app/dashboard/page.tsx` | 使用者儀表板 |
| `/dashboard/subscriptions` | `app/dashboard/subscriptions/page.tsx` | 訂閱管理 |
| `/dashboard/keys` | `app/dashboard/keys/page.tsx` | API Key 管理 |
| `/dashboard/keys/[subId]` | `app/dashboard/keys/[subId]/page.tsx` | 訂閱下的 Key 詳情 |

### 3.2 API 路由（Route Handlers）

| Method | URL | 下游呼叫 | 說明 |
|---|---|---|---|
| POST | `/api/auth/login` | → `auth-service:8081/auth/login` | 登入 Proxy |
| POST | `/api/auth/logout` | → `auth-service:8081/auth/logout` | 登出 Proxy |
| POST | `/api/auth/register` | → `auth-service:8081/auth/register` | 註冊 Proxy |
| GET | `/api/health` | — | Portal 健康檢查 |
| GET | `/api/spec/[apiId]` | → `registry-service:8082/apis/:id/versions/*/spec` | OpenAPI Spec 代理 |
| ALL | `/graphql` | → `bff:4000/graphql` | GraphQL 直連 |

---

## 四、Gateway（動態代理）

**服務：** `gateway:8080` | **原始碼：** `gateway/src/`

### 4.1 固定端點

| Method | 路徑 | 說明 |
|---|---|---|
| GET | `/healthz` | 健康檢查（含 Redis 狀態 + 路由數） |
| GET | `/metrics` | Prometheus 指標 |

### 4.2 動態路由（catch-all）

```
ALL /*
  ① matchRoute(host, path, method)
     ← 路由表來自 registry-service:8082/internal/routes/delta
     ← 快取於 Redis key: gateway:routes（TTL 60s）
     ← 每 5s 增量同步
  
  ② executePhase(pre_request)
     ← 策略鏈來自 policy-engine:8083/v1/chains/:apiId（TTL 5min）
     
     Plugin 執行順序（依 order 欄位）:
     ┌─────────────────────────────────────────────────────────┐
     │ auth / jwt_auth / api_key_auth                         │
     │   jwt_auth  → 驗證 JWT Bearer token（auth-service JWKS）│
     │   api_key_auth → subscription-service:8084/internal/   │
     │                  keys/verify                           │
     │ ip_whitelist  → 來源 IP 白名單檢查                      │
     │ rate_limit    → subscription-service:8084/internal/    │
     │                 quota/check（按訂閱計畫）               │
     │ cors          → CORS headers 注入                       │
     │ transform     → 請求頭/Body 轉換                        │
     │ cache         → Redis 快取回應（命中則 bypass 上游）     │
     │ circuit_breaker → 熔斷器（超閾值短路）                  │
     └─────────────────────────────────────────────────────────┘
  
  ③ forwardRequest(route.upstreamUrl, ...)
     URL 重寫：path.replace(strip_prefix, "")
     上游位址：由 registry 動態注冊（任意 HTTP URL）
  
  ④ executePhase(post_response)
     usage / transform 等後置 plugin
     → subscription-service:8084/internal/usage/increment
  
  ⑤ metrics: requestsTotal, requestDuration（Prometheus Counter/Histogram）
```

### 4.3 路由同步流程

```
Gateway 啟動
  → loadFromCache()     Redis gateway:routes → 記憶體路由表
  → fullSync()          registry-service:8082/internal/routes/delta?since=0
  → setInterval(5s)     syncRoutes() → /internal/routes/delta?since={lastSyncAt}
```

---

## 五、Auth Service（Go/Gin）

**服務：** `auth-service:8081` | **原始碼：** `manager/services/auth/internal/handler/router.go`

| Method | 路徑 | Middleware | 說明 |
|---|---|---|---|
| GET | `/health` | — | 健康檢查 |
| GET | `/ready` | — | 就緒檢查 |
| GET | `/metrics` | — | Prometheus 指標 |
| POST | `/auth/register` | rate(5/min) | 使用者註冊 |
| POST | `/auth/login` | rate(10/min) | 登入，回傳 JWT + Session |
| POST | `/auth/logout` | requireSession | 登出，撤銷 Session + Redis 黑名單 |
| GET | `/auth/me` | requireSession | 取得目前使用者資訊 |
| GET | `/oauth2/authorize` | requireSession | OAuth2 授權碼流程 |
| POST | `/oauth2/token` | rate(20/min) | 取得 Access Token |
| POST | `/oauth2/revoke` | rate(20/min) | 撤銷 Token |
| GET | `/oauth2/jwks` | — | 公鑰集（Gateway 驗簽用） |
| GET | `/oauth2/.well-known/openid-configuration` | — | OIDC Discovery |

**被誰呼叫：**
- Gateway plugin `jwt_auth` → `/oauth2/jwks`（JWKS 驗簽）
- Portal API routes → `/auth/login`, `/auth/logout`, `/auth/register`
- BFF DataSource `AuthAPI` → `/auth/me`

---

## 六、Registry Service（Go/Gin）

**服務：** `registry-service:8082` | **原始碼：** `manager/services/registry/internal/handler/router.go`

| Method | 路徑 | Middleware | 說明 |
|---|---|---|---|
| GET | `/health` | — | 健康檢查 |
| GET | `/ready` | — | 就緒檢查 |
| GET | `/metrics` | — | Prometheus 指標 |
| GET | `/apis` | requireAuth | 列出所有 API |
| POST | `/apis` | requireAuth | 建立 API |
| GET | `/apis/:id` | requireAuth | 取得 API 詳情 |
| PUT | `/apis/:id` | requireAuth | 更新 API |
| DELETE | `/apis/:id` | requireAuth | 刪除 API |
| GET | `/apis/:id/versions` | requireAuth | 列出 API 版本 |
| POST | `/apis/:id/versions` | requireAuth | 新增版本 |
| GET | `/apis/:id/versions/:version/spec` | requireAuth | 取得 OpenAPI Spec |
| PUT | `/apis/:id/versions/:version/spec` | requireAuth | 更新 Spec |
| POST | `/apis/:id/versions/:version/publish` | requireAuth | 發佈版本 |
| POST | `/apis/:id/versions/:version/deprecate` | requireAuth | 棄用版本 |
| GET | `/internal/routes` | InternalAuth | Gateway 取得完整路由表 |
| GET | `/internal/routes/delta` | InternalAuth | Gateway 增量同步路由 |

**被誰呼叫：**
- Gateway → `/internal/routes/delta`（每 5s 同步路由表）
- BFF `RegistryAPI` → `/apis`, `/apis/:id`, POST/PUT/DELETE `/apis/:id`
- Portal `/api/spec/[apiId]` → `/apis/:id/versions/*/spec`

---

## 七、Subscription Service（Go/Gin）

**服務：** `subscription-service:8084` | **原始碼：** `manager/services/subscription/internal/handler/router.go`

### 7.1 對外 API

| Method | 路徑 | Middleware | 說明 |
|---|---|---|---|
| GET | `/healthz` | — | 健康檢查 |
| GET | `/ready` | — | 就緒檢查 |
| GET | `/metrics` | — | Prometheus 指標 |
| GET | `/v1/plans` | — | 列出所有方案 |
| GET | `/v1/plans/:id` | — | 取得方案詳情 |
| GET | `/v1/subscriptions` | requireAuth | 列出訂閱 |
| POST | `/v1/subscriptions` | requireAuth | 建立訂閱 |
| GET | `/v1/subscriptions/:id` | requireAuth | 取得訂閱詳情 |
| PUT | `/v1/subscriptions/:id/approve` | requireAuth+Admin | 審核通過 |
| PUT | `/v1/subscriptions/:id/suspend` | requireAuth+Admin | 暫停訂閱 |
| PUT | `/v1/subscriptions/:id/cancel` | requireAuth | 取消訂閱 |
| PUT | `/v1/subscriptions/:id/plan` | requireAuth | 更換方案 |
| GET | `/v1/subscriptions/:id/keys` | requireAuth | 列出 API Keys |
| POST | `/v1/subscriptions/:id/keys` | requireAuth | 建立 API Key |
| DELETE | `/v1/subscriptions/:id/keys/:key_id` | requireAuth | 刪除 API Key |
| GET | `/v1/subscriptions/:id/quota` | requireAuth | 查詢配額設定 |
| GET | `/v1/subscriptions/:id/usage` | requireAuth | 查詢使用量 |

### 7.2 內部 API（服務間呼叫，需 X-Internal-Token）

| Method | 路徑 | Middleware | 說明 |
|---|---|---|---|
| POST | `/internal/keys/verify` | InternalAuth | Gateway 驗證 API Key |
| POST | `/internal/usage/increment` | InternalAuth | Gateway 上報用量 |
| GET | `/internal/quota/check` | InternalAuth | Gateway 查詢配額 |

**被誰呼叫：**
- Gateway plugin `api_key_auth` → `/internal/keys/verify`
- Gateway plugin `rate_limit` → `/internal/quota/check`
- Gateway plugin `usage`（post_response）→ `/internal/usage/increment`
- BFF `SubscriptionAPI` → `/v1/plans/*`, `/v1/subscriptions/*`

---

## 八、BFF（Apollo GraphQL）

**服務：** `bff:4000` | **原始碼：** `manager/bff/src/`

### 8.1 HTTP 端點

| Method | 路徑 | 說明 |
|---|---|---|
| POST/GET | `/graphql` | GraphQL 主端點（含 WS Subscription） |
| GET | `/healthz` | 健康檢查 |

### 8.2 GraphQL Schema

**Queries（查詢）**

| Query | 呼叫 DataSource | 說明 |
|---|---|---|
| `me` | AuthAPI → auth-service | 目前使用者 |
| `organizations` | RegistryAPI | 列出組織 |
| `organization(id)` | RegistryAPI | 取得組織 |
| `apis(filter)` | RegistryAPI → `/apis` | 列出 API |
| `api(id)` | RegistryAPI → `/apis/:id` | 取得 API |
| `plans` | SubscriptionAPI → `/v1/plans` | 列出方案 |
| `plan(id)` | SubscriptionAPI → `/v1/plans/:id` | 取得方案 |
| `subscriptions` | SubscriptionAPI → `/v1/subscriptions` | 列出訂閱 |
| `subscription(id)` | SubscriptionAPI → `/v1/subscriptions/:id` | 取得訂閱 |
| `apiKeys(subId)` | SubscriptionAPI → `/v1/subscriptions/:id/keys` | 列出 Keys |
| `apiKey(id)` | SubscriptionAPI | 取得 Key |
| `policyChain(apiId)` | PolicyAPI → policy-engine | 取得策略鏈 |

**Mutations（變更）**

| Mutation | 呼叫 DataSource | 說明 |
|---|---|---|
| `createOrganization` | RegistryAPI | 建立組織 |
| `updateOrganization` | RegistryAPI | 更新組織 |
| `deleteOrganization` | RegistryAPI | 刪除組織 |
| `createAPI` | RegistryAPI → POST `/apis` | 建立 API |
| `updateAPI` | RegistryAPI → PUT `/apis/:id` | 更新 API |
| `deleteAPI` | RegistryAPI → DELETE `/apis/:id` | 刪除 API |
| `createPlan` | SubscriptionAPI | 建立方案 |
| `updatePlan` | SubscriptionAPI | 更新方案 |
| `deletePlan` | SubscriptionAPI | 刪除方案 |
| `createSubscription` | SubscriptionAPI → POST `/v1/subscriptions` | 建立訂閱 |
| `updateSubscriptionStatus` | SubscriptionAPI → PUT `/v1/subscriptions/:id/*` | 更新狀態 |
| `cancelSubscription` | SubscriptionAPI → PUT `/:id/cancel` | 取消訂閱 |
| `createAPIKey` | SubscriptionAPI → POST `/:id/keys` | 建立 Key |
| `revokeAPIKey` | SubscriptionAPI → DELETE `/:id/keys/:key_id` | 撤銷 Key |
| `publishPolicyChain` | PolicyAPI | 發佈策略鏈 |
| `invalidatePolicyCache` | PolicyAPI | 清除策略快取 |

---

## 九、Analytics Service（Node.js）

**服務：** `analytics-service:8085` | **原始碼：** `manager/services/analytics/src/http/routes.ts`

| Method | 路徑 | 說明 |
|---|---|---|
| GET | `/v1/metrics/summary` | API 使用摘要統計 |
| GET | `/v1/metrics/timeseries` | 時序數據 |
| GET | `/v1/metrics/top-clients` | Top N 客戶端 |
| GET | `/v1/metrics/quota` | 配額使用率 |
| GET | `/v1/metrics/realtime` | 即時數據（SSE/WS） |

---

## 十、Notification Service（Node.js）

**服務：** `notification-service:8086` | **原始碼：** `manager/services/notification/src/http/routes.ts`

| Method | 路徑 | 說明 |
|---|---|---|
| GET | `/v1/notifications` | 列出通知 |
| GET | `/v1/notifications/:id` | 取得通知詳情 |
| POST | `/v1/notifications/send` | 發送通知 |

---

## 十一、Policy Engine

**服務：** `policy-engine:8083` | **狀態：** Placeholder（目錄為空，尚未實作）

**規劃端點（Gateway executor 已整合）：**

| Method | 路徑 | 說明 |
|---|---|---|
| GET | `/v1/chains/:apiId` | 取得 API 策略鏈（Gateway 每 5min 快取） |
| POST | `/v1/chains` | 建立策略鏈（Studio 透過 BFF Mutation） |
| PUT | `/v1/chains/:id` | 更新策略鏈 |
| POST | `/v1/cache/invalidate` | 清除 Gateway 策略快取 |

---

## 十二、服務間通訊矩陣

```
呼叫方                    → 被呼叫方                    端點
─────────────────────────────────────────────────────────────────
Gateway                  → Registry Service             /internal/routes/delta
Gateway (jwt_auth)       → Auth Service                 /oauth2/jwks (JWKS 驗簽)
Gateway (api_key_auth)   → Subscription Service         /internal/keys/verify
Gateway (rate_limit)     → Subscription Service         /internal/quota/check
Gateway (usage)          → Subscription Service         /internal/usage/increment
Gateway (policy)         → Policy Engine                /v1/chains/:apiId
Portal /api/auth/*       → Auth Service                 /auth/{login,logout,register}
Portal /api/spec/:id     → Registry Service             /apis/:id/versions/*/spec
BFF (AuthAPI)            → Auth Service                 /auth/me
BFF (RegistryAPI)        → Registry Service             /apis/**
BFF (SubscriptionAPI)    → Subscription Service         /v1/**
BFF (PolicyAPI)          → Policy Engine                /v1/chains/**
Subscription Service     → Auth Service                 /auth/me (訂閱驗證)
Subscription Service     → Registry Service             /apis/:id (API 存在驗證)
```

**內部服務驗證：** 所有 `InternalAuth` 端點需附帶
```
X-Internal-Token: SHA256(INTERNAL_SERVICE_SECRET)
```

---

## 十三、Prometheus 採集端點

**設定檔：** `infra/prometheus/prometheus.yml`

| 服務 | 採集 Target | 路徑 |
|---|---|---|
| Gateway | `gateway:8080` | `/metrics` |
| Auth Service | `auth-service:8081` | `/metrics` |
| Registry Service | `registry-service:8082` | `/metrics` |
| Subscription Service | `subscription-service:8084` | `/metrics` |
| Analytics Service | `analytics-service:8085` | `/metrics` |
| Notification Service | `notification-service:8086` | `/metrics` |
| Nginx | `nginx-exporter:9113` | — |
| Kafka | `kafka-exporter:9308` | — |
| MongoDB | `mongodb-exporter:9216` | — |
| Redis | `redis-exporter:9121` | — |
| PostgreSQL | `postgres-exporter:9187` | — |

> ⚠️ Policy Engine、BFF 目前無 `/metrics` 端點。

---

## 附錄：Port 速查表

| 服務 | 容器 Port | 開發 Host Port |
|---|---|---|
| Nginx | 80 / 443 | **19000** (HTTP) |
| Portal | 3001 | 13001 |
| Gateway | 8080 | 18090 |
| BFF | 4000 | 14000 |
| Auth Service | 8081 | 18081 |
| Registry Service | 8082 | 18082 |
| Policy Engine | 8083 | 18083 |
| Subscription Service | 8084 | 18084 |
| Analytics Service | 8085 | 18085 |
| Notification Service | 8086 | 18086 |
| PostgreSQL | 5432 | 15432 |
| MongoDB | 27017 | 27017 |
| Redis | 6379 | 16379 |
| Kafka | 9092 | 19092 |
| Prometheus | 9090 | 19090 |
| Grafana | 3000 | 13000 |
| Jaeger UI | 16686 | 16686 |
