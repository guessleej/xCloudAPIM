# xCloudAPIM — 企業級 API Management 平台

## 服務架構

| 服務 | 目錄 | 技術 | Port |
|------|------|------|------|
| API Gateway | `gateway/` | Node.js 20 + Fastify | 3000 |
| Policy Engine | `policy-engine/` | Go 1.22 + gRPC | 50051 |
| Auth Service | `manager/services/auth/` | Go 1.22 | 8081 |
| API Registry | `manager/services/registry/` | Go 1.22 | 8082 |
| Subscription | `manager/services/subscription/` | Go 1.22 | 8084 |
| Analytics | `manager/services/analytics/` | Node.js | 8085 |
| BFF GraphQL | `manager/bff/` | Node.js + Apollo | 4000 |
| Policy Studio | `studio/` | React 18 + Vite | 5173 |
| Developer Portal | `portal/` | Next.js 14 | 3001 |

## 快速開始

```bash
# 1. 複製環境變數
cp .env.example .env

# 2. 啟動基礎設施
make infra-up

# 3. 執行 DB migrations
make migrate

# 4. 初始化 Vault
make vault-init

# 5. 啟動所有服務
make up

# 6. 查看狀態
make status
```

## 常用指令

```bash
make help          # 查看所有指令
make up            # 啟動所有服務
make down          # 停止服務
make logs          # 查看 logs
make logs-gateway  # 查看特定服務 logs
make test          # 執行測試
make migrate       # 執行 DB migrations
make vault-init    # 初始化 Vault
make proto-gen     # 產生 Protobuf 程式碼
```
