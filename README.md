# xCloudAPIM — 企業級 API Management 平台

## 服務架構

| 服務 | 目錄 | 技術 | Port |
|------|------|------|------|
| Nginx edge | `infra/nginx/` | Nginx reverse proxy | 19000 / 19443 |
| API Gateway | `gateway/` | Node.js 20 + Fastify | 18090 -> 8080 |
| Policy Engine | `policy-engine/` | Go 1.22 + gRPC | 50051 |
| Auth Service | `manager/services/auth/` | Go 1.22 | 18091 -> 8081 |
| API Registry | `manager/services/registry/` | Go 1.22 | 18082 -> 8082 |
| Subscription | `manager/services/subscription/` | Go 1.22 | 18084 -> 8084 |
| Analytics | `manager/services/analytics/` | Node.js | 8085 |
| BFF GraphQL | `manager/bff/` | Node.js + Apollo | 14000 -> 4000 |
| Policy Studio | `studio/` | React 18 + Vite | 5173 |
| Developer Portal | `portal/` | Next.js 14 | 19000 via Nginx, 3001 direct |

## 快速開始

```bash
# 1. 檢查本機工具鏈
mise install
make doctor

# 2. 複製環境變數
cp .env.example .env

# 3. 啟動基礎設施
make infra-up

# 4. 執行 DB migrations + seed
make migrate
make seed

# 5. 初始化 Vault
make vault-init

# 6. 啟動所有服務
make up

# 7. 查看狀態
make status
```

完整第一次啟動、建立帳號、套 migration、重建服務流程見 `docs/FIRST_RUN.md`。

## 常用指令

```bash
make help          # 查看所有指令
make up            # 啟動所有服務
make down          # 停止服務
make logs          # 查看 logs
make logs-gateway  # 查看特定服務 logs
make test          # 執行測試
make test-e2e      # 驗證 Portal/BFF/Gateway 本機 smoke flow
make migrate       # 執行 DB migrations
make vault-init    # 初始化 Vault
make proto-gen     # 產生 Protobuf 程式碼
make load-test     # 對 Gateway health endpoint 執行 K6 smoke/load 測試
```

## Toolchain

本機建議使用 `mise` 或 `asdf` 讀取 `.tool-versions`。詳細版本與 bootstrap 步驟見 `docs/TOOLCHAIN.md`。

## 本機入口

```text
Portal:        http://localhost:19000
Portal direct: http://localhost:3001
Gateway:       http://localhost:18090
BFF GraphQL:   http://localhost:14000/graphql
Auth health:   http://localhost:18091/healthz
Registry:      http://localhost:18082/healthz
Studio:        http://localhost:5173
```
