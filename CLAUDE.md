# CLAUDE.md

本檔案提供給 AI 助理（Claude）在此 codebase 工作時的高密度導覽。內容聚焦於「不顯而易見」的事項；基礎操作請對照 `README.md`、`docs/`。

## 專案定位（一句話）

**xCloudAPIM** 是一個企業級、多服務（polyglot）的 **API Management 平台**：Nginx edge → Fastify API Gateway（動態代理 + plugin pipeline）→ 一組 Go/Node 控制平面微服務（Auth / Registry / Subscription / Policy Engine / Analytics / Notification），搭配 Apollo GraphQL BFF、Next.js Developer Portal 與 React Policy Studio。

## 技術棧

- **Gateway / BFF / Analytics / Notification**：Node.js 20（`engines: >=20`，工具鏈鎖定 20.14.0）+ TypeScript。Gateway/BFF 用 **Fastify / Apollo**，以 `tsx` 跑 dev 與 test。
- **Auth / Registry / Subscription / Policy Engine**：**Go**（Gin + gRPC）。注意版本不一致：各 `go.mod` 宣告 `go 1.25.0`，但 `docs/TOOLCHAIN.md` 與 README 寫 Go 1.22.x — 本機請以工具鏈文件為準，遇建置問題先確認 Go 版本。
- **Portal**：Next.js 14（App Router，含 route handlers proxy）。**Studio**：React 18 + Vite + Tailwind。
- **資料層**：PostgreSQL（核心關聯資料，Flyway migration）、MongoDB（analytics/notification）、Redis（路由快取、quota、session 黑名單）、Kafka（事件）、Vault（PKI / JWT 金鑰 / secrets）。
- **可觀測性**：Prometheus / Grafana / Jaeger / Alertmanager（`infra/`）。
- 全部以 **Docker Compose** 編排（`docker-compose.yml` 約 1300+ 行為主檔；另有 `.prod.yml`、`.test.yml`）。

## 模組 / 服務地圖

| 目錄 | 角色 | 語言 | 容器 Port / Dev Host Port |
|------|------|------|------|
| `infra/nginx/` | edge 反向代理、TLS 終止、依 Host/Path 分流 | Nginx | 80·443 / **19000** |
| `gateway/` | **資料平面**：動態路由比對 + plugin pipeline + 上游代理 | Node/Fastify | 8080 / 18090 |
| `policy-engine/` | 策略鏈編譯與執行（已實作；gRPC + HTTP） | Go | 8083 + gRPC 50051 / 18083 |
| `manager/services/auth/` | 登入、Session、OAuth2/OIDC、JWKS | Go/Gin | 8081 / 18091·18081 |
| `manager/services/registry/` | API 與版本註冊、OpenAPI spec、Gateway 路由表來源 | Go/Gin | 8082 / 18082 |
| `manager/services/subscription/` | 方案、訂閱、API Key、quota/usage（Gateway 內部呼叫） | Go/Gin | 8084 / 18084 |
| `manager/services/analytics/` | 使用量統計、時序、即時數據 | Node | 8085 / 18085 |
| `manager/services/notification/` | 通知發送（MongoDB） | Node | 8086 / 18086 |
| `manager/bff/` | **控制平面 BFF**：Apollo GraphQL，聚合上述服務供前端使用 | Node/Apollo | 4000 / 14000 |
| `portal/` | Developer Portal（API 目錄、訂閱、Key 管理） | Next.js 14 | 3001 / 13001 |
| `studio/` | Policy Studio（策略編輯 UI，呼叫 BFF） | React+Vite | 80(nginx)·5173 dev |
| `packages/shared/` | 共用 TS types/utils + `proto/policy.proto`（proto 為單一真實來源） | TS | — |
| `migrations/` | Flyway SQL（`V1..V8`，依序執行，勿改既有檔，新增遞增版本） | SQL | — |
| `infra/`, `scripts/`, `seeds/`, `load-tests/`, `collections/`, `docs/` | 觀測設定、bootstrap 腳本、種子資料、K6、Bruno/Postman、文件 | — | — |

> 完整路由串接圖與服務間呼叫矩陣見 **`docs/ROUTING.md`**（權威來源，含每個 router.go / routes.ts 端點）。注意 ROUTING.md 第十一節仍把 Policy Engine 標為「placeholder」，但它**已被實作**（見 `policy-engine/internal/`），該段落已過時。

## 建置 / 執行 / 測試 / Lint（已驗證的指令）

一切以根目錄 `Makefile` 為入口（`make help` 列出全部）。

```bash
make doctor        # 檢查本機工具鏈（Node/Go/Docker）
make infra-up      # 啟動 DB / Redis / Kafka / Vault
make migrate       # Flyway migrations    make seed      # 種子資料
make vault-init    # 初始化 Vault（PKI + JWT keys）
make up            # 啟動所有服務（dev 模式）；make up-build 重建後啟動
make status / make logs / make logs-gateway

make test          # 跑全部單元測試（Go: policy-engine,auth,registry；Node: gateway,bff,studio）
make test-go       # 僅 Go（透過 scripts/go-test.sh）。本機預設「不開 race」；GO_TEST_RACE=1 才啟用
make test-e2e      # node --test tests/e2e/*.test.mjs（需所有服務在跑）
make typecheck     # 6 個 TS 專案 tsc --noEmit（gateway,bff,studio,portal,analytics,notification）
make lint          # golangci-lint + 各前端 npm run lint
make fmt           # gofmt + prettier
make ci-local      # = lint + typecheck + test-go（本地模擬 CI）
make proto-gen     # 從 packages/shared/proto/*.proto 產生 Go + TS
make load-test     # K6 smoke（需 docker network xcloudapim_apim-net 存在，即服務已 up）
```

各 Node 服務本身的 npm scripts 一致：`dev`（tsx watch）、`build`（tsc）、`start`、`test`、`typecheck`。Go 服務測試用 `go test ./...`。

## 慣例

- **首次啟動順序固定**：infra-up → migrate → seed → vault-init → up（見 `docs/FIRST_RUN.md`）。跳過會導致服務啟動失敗。
- **本機 typecheck/test 前需先 `npm ci`**（依服務分別執行；不要依賴全域 `tsc`）。
- **Docker Compose 用 `docker compose`（v2），不要用舊版 `docker-compose`**。
- **語言**：文件、commit message、程式碼註解以**繁體中文**為主，英文為輔 — 新增內容請沿用。
- **Commit 風格**：Conventional Commits（`feat(scope):`、`fix(ci):`、`docs:` …），description 多為繁中。
- **環境變數**：以 `.env.example` 為樣板複製成 `.env`；服務 port、DB、JWT、Vault、Kafka topic 皆由此驅動。
- Go module 路徑統一為 `github.com/xcloudapim/<service>-service`（policy-engine 為 `.../policy-engine`）。

## 不顯而易見的地雷（Gotchas）

- **沒有 CI workflow**：`.github/workflows/` 已被移除（commit `bc535a2`「version backup only」）。請用 `make ci-local` 在本機驗證，勿假設有 GitHub Actions 會跑。
- **Go 版本不一致**（go.mod 1.25.0 vs 文件 1.22.x）— 建置/lint 失敗時優先排查。
- **race detector 在本機預設關閉**（舊 Go 1.22 race binary 在新版 macOS dyld 會失敗）；CI/Linux 才開 race。
- **`make test` / `make lint` 大量使用 `|| true`**：個別服務失敗不會讓整個 target 失敗，務必逐行看輸出，別只看退出碼。
- **服務間內部端點需 `X-Internal-Token: SHA256(INTERNAL_SERVICE_SECRET)`**（Gateway → subscription `/internal/keys/verify`、`/internal/quota/check`、`/internal/usage/increment` 等）。
- **Gateway 路由表是動態的**：來自 `registry-service` 的 `/internal/routes/delta`，快取在 Redis key `gateway:routes`（TTL 60s），每 5s 增量同步 — 改路由要透過 Registry，不是改 Gateway 程式碼。
- **Gateway plugin pipeline 依 `order` 欄位排序執行**（`gateway/src/pipeline/`：auth/jwt/api-key、ip-whitelist、rate-limit、cors、transform、cache、circuit-breaker），策略鏈來自 Policy Engine（快取 5min）。
- **Migration 不可變更既有 `V*.sql`**：Flyway 以 checksum 驗證；只新增更高版本號。
- **Port 有「容器 vs dev host」兩套**（如 Auth 容器 8081 / host 18091 或 18081 — README 與 ROUTING.md 附錄略有出入，以 `docker-compose.yml` 為準）。
- **`proto/policy.proto` 是 Policy 契約單一真實來源**；改動後須 `make proto-gen` 同步 Go 與 TS。
</content>
</invoke>
