# ═══════════════════════════════════════════════════════════════
#  xCloudAPIM — 根目錄 Makefile
# ═══════════════════════════════════════════════════════════════
SHELL := /bin/bash
.DEFAULT_GOAL := help

# ─── 顏色定義 ────────────────────────────────────────────────
GREEN  := \033[0;32m
YELLOW := \033[0;33m
CYAN   := \033[0;36m
RESET  := \033[0m

# ─── 變數 ────────────────────────────────────────────────────
COMPOSE         := docker compose
COMPOSE_FILE    := docker-compose.yml
COMPOSE_PROD    := docker-compose.prod.yml
COMPOSE_TEST    := docker-compose.test.yml
ENV_FILE        := .env
IMAGE_TAG       ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "latest")
BUILD_DATE      ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
GIT_COMMIT      ?= $(shell git rev-parse HEAD 2>/dev/null || echo "unknown")

# ═══════════════════════════════════════════════════════════════
#  HELP
# ═══════════════════════════════════════════════════════════════
.PHONY: help
help: ## 顯示所有可用指令
	@echo ""
	@echo "$(CYAN)xCloudAPIM — 企業級 API Management 平台$(RESET)"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ { printf "  $(GREEN)%-22s$(RESET) %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""

# ═══════════════════════════════════════════════════════════════
#  SETUP
# ═══════════════════════════════════════════════════════════════
.PHONY: init
init: ## 初始化專案（首次使用）
	@echo "$(YELLOW)▶ 初始化專案...$(RESET)"
	@[ -f $(ENV_FILE) ] || cp .env.example $(ENV_FILE) && echo "  ✅ .env 已建立，請編輯填入設定值"
	@$(MAKE) deps
	@echo "$(GREEN)✅ 初始化完成，執行 make up 啟動服務$(RESET)"

.PHONY: deps
deps: ## 安裝所有服務的相依套件
	@echo "$(YELLOW)▶ 安裝 gateway 套件...$(RESET)"
	@[ -f gateway/package.json ] && cd gateway && npm install || true
	@echo "$(YELLOW)▶ 安裝 manager/bff 套件...$(RESET)"
	@[ -f manager/bff/package.json ] && cd manager/bff && npm install || true
	@echo "$(YELLOW)▶ 安裝 studio 套件...$(RESET)"
	@[ -f studio/package.json ] && cd studio && npm install || true
	@echo "$(YELLOW)▶ 安裝 portal 套件...$(RESET)"
	@[ -f portal/package.json ] && cd portal && npm install || true
	@echo "$(YELLOW)▶ 下載 Go 模組 (policy-engine)...$(RESET)"
	@[ -f policy-engine/go.mod ] && cd policy-engine && go mod download || true
	@echo "$(YELLOW)▶ 下載 Go 模組 (manager/services)...$(RESET)"
	@for svc in auth registry policy subscription analytics notification; do \
	  [ -f manager/services/$$svc/go.mod ] && (cd manager/services/$$svc && go mod download) || true; \
	done

.PHONY: doctor
doctor: ## 檢查本機 toolchain 是否齊全
	@bash scripts/dev-doctor.sh

.PHONY: certs
certs: ## 產生本地 TLS 憑證（需要 mkcert 或 openssl）
	@bash scripts/gen-certs.sh

.PHONY: htpasswd
htpasswd: ## 產生管理介面 Nginx Basic Auth 密碼檔
	@bash scripts/gen-htpasswd.sh

.PHONY: secure-setup
secure-setup: certs htpasswd ## 完整安全初始化（TLS 憑證 + Basic Auth 密碼）
	@echo "$(GREEN)✅ 安全設定完成$(RESET)"

.PHONY: bootstrap-go
bootstrap-go: ## 安裝/啟用 Go 1.22.5（優先 mise/asdf，否則提示 Homebrew 安裝 mise）
	@echo "$(YELLOW)▶ 準備 Go 1.22.5 toolchain...$(RESET)"
	@if command -v mise >/dev/null 2>&1; then \
	  mise install go@1.22.5; \
	  echo "$(GREEN)✅ Go 已由 mise 安裝。使用：mise exec -- go version$(RESET)"; \
	elif command -v asdf >/dev/null 2>&1; then \
	  asdf plugin add golang https://github.com/asdf-community/asdf-golang.git 2>/dev/null || true; \
	  asdf install golang 1.22.5; \
	  echo "$(GREEN)✅ Go 已由 asdf 安裝。請重新載入 shell 後執行 go version$(RESET)"; \
	elif command -v brew >/dev/null 2>&1; then \
	  echo "未找到 mise/asdf。建議先執行：brew install mise && mise install"; \
	  exit 1; \
	else \
	  echo "未找到 mise/asdf/brew。請安裝 mise 後執行：mise install"; \
	  exit 1; \
	fi

# ═══════════════════════════════════════════════════════════════
#  DOCKER — 基礎設施
# ═══════════════════════════════════════════════════════════════
.PHONY: infra-up
infra-up: ## 啟動基礎設施服務（DB / Redis / Kafka / Vault）
	@echo "$(YELLOW)▶ 啟動基礎設施...$(RESET)"
	@$(COMPOSE) -f $(COMPOSE_FILE) up -d postgres redis-master-1 redis-master-2 redis-master-3 zookeeper kafka kafka-init vault vault-init mongodb elasticsearch
	@echo "$(GREEN)✅ 基礎設施啟動完成$(RESET)"

.PHONY: infra-down
infra-down: ## 停止基礎設施服務
	@$(COMPOSE) -f $(COMPOSE_FILE) stop postgres redis-master-1 redis-master-2 redis-master-3 zookeeper kafka vault mongodb elasticsearch

# ═══════════════════════════════════════════════════════════════
#  DOCKER — 全服務
# ═══════════════════════════════════════════════════════════════
.PHONY: up
up: ## 啟動所有服務（開發模式）
	@echo "$(YELLOW)▶ 啟動所有服務...$(RESET)"
	@$(COMPOSE) -f $(COMPOSE_FILE) up -d
	@echo "$(GREEN)✅ 所有服務啟動完成$(RESET)"
	@$(MAKE) status

.PHONY: up-build
up-build: ## 重新建置並啟動所有服務
	@$(COMPOSE) -f $(COMPOSE_FILE) up -d --build

.PHONY: down
down: ## 停止並移除所有容器（保留 volumes）
	@echo "$(YELLOW)▶ 停止所有服務...$(RESET)"
	@$(COMPOSE) -f $(COMPOSE_FILE) down

.PHONY: down-v
down-v: ## 停止並移除所有容器及 volumes（⚠️ 資料會清除）
	@echo "$(YELLOW)⚠️  即將清除所有資料 volumes...$(RESET)"
	@read -p "確認？[y/N] " confirm && [ "$$confirm" = "y" ] && \
	  $(COMPOSE) -f $(COMPOSE_FILE) down -v || echo "已取消"

.PHONY: restart
restart: ## 重啟所有服務
	@$(COMPOSE) -f $(COMPOSE_FILE) restart

.PHONY: status
status: ## 查看各服務狀態與連線資訊
	@echo ""
	@echo "$(CYAN)服務狀態$(RESET)"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@$(COMPOSE) -f $(COMPOSE_FILE) ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
	@echo ""
	@echo "$(CYAN)連線資訊$(RESET)"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo "  Nginx Portal     → http://localhost:19000"
	@echo "  API Gateway      → http://localhost:18090"
	@echo "  BFF GraphQL      → http://localhost:14000/graphql"
	@echo "  Auth Service     → http://localhost:18091/healthz"
	@echo "  Registry Service → http://localhost:18082/healthz"
	@echo "  Policy Studio    → http://localhost:5173"
	@echo "  Developer Portal → http://localhost:3001  (direct)"
	@echo "  Grafana          → http://localhost:3002  (admin / GF_SECURITY_ADMIN_PASSWORD)"
	@echo "  Kafka UI         → http://localhost:8080"
	@echo "  pgAdmin          → http://localhost:5050"
	@echo "  Mongo Express    → http://localhost:18081"
	@echo "  Vault UI         → http://localhost:8200  (token: VAULT_TOKEN in .env)"
	@echo "  Jaeger UI        → http://localhost:16686"
	@echo "  Kibana           → http://localhost:5601"
	@echo "  Mailhog          → http://localhost:8025"
	@echo ""

# ═══════════════════════════════════════════════════════════════
#  DOCKER — 個別服務
# ═══════════════════════════════════════════════════════════════
.PHONY: logs
logs: ## 追蹤所有服務 logs（Ctrl+C 結束）
	@$(COMPOSE) -f $(COMPOSE_FILE) logs -f

.PHONY: logs-%
logs-%: ## 追蹤特定服務 logs（make logs-gateway）
	@$(COMPOSE) -f $(COMPOSE_FILE) logs -f $*

.PHONY: build-%
build-%: ## 重新建置特定服務 image（make build-gateway）
	@$(COMPOSE) -f $(COMPOSE_FILE) build $*

.PHONY: restart-%
restart-%: ## 重啟特定服務（make restart-gateway）
	@$(COMPOSE) -f $(COMPOSE_FILE) restart $*

.PHONY: shell-%
shell-%: ## 進入特定服務 shell（make shell-postgres）
	@$(COMPOSE) -f $(COMPOSE_FILE) exec $* sh

# ═══════════════════════════════════════════════════════════════
#  DATABASE
# ═══════════════════════════════════════════════════════════════
.PHONY: migrate
migrate: ## 執行資料庫 migrations（Flyway）
	@echo "$(YELLOW)▶ 執行 DB migrations...$(RESET)"
	@$(COMPOSE) -f $(COMPOSE_FILE) run --rm flyway migrate
	@echo "$(GREEN)✅ Migrations 執行完成$(RESET)"

.PHONY: migrate-info
migrate-info: ## 查看 migration 狀態
	@$(COMPOSE) -f $(COMPOSE_FILE) run --rm flyway info

.PHONY: migrate-clean
migrate-clean: ## 清除 DB 並重新 migrate（⚠️ 開發環境用）
	@$(COMPOSE) -f $(COMPOSE_FILE) run --rm flyway clean migrate

.PHONY: seed
seed: ## 插入測試資料（開發環境）
	@echo "$(YELLOW)▶ 插入測試種子資料...$(RESET)"
	@$(COMPOSE) -f $(COMPOSE_FILE) exec -T postgres psql -U apim_user -d apim -f /seeds/seed.sql
	@echo "$(GREEN)✅ 種子資料插入完成$(RESET)"

.PHONY: db-shell
db-shell: ## 進入 PostgreSQL shell
	@$(COMPOSE) -f $(COMPOSE_FILE) exec postgres psql -U apim_user -d apim

# ═══════════════════════════════════════════════════════════════
#  VAULT
# ═══════════════════════════════════════════════════════════════
.PHONY: vault-init
vault-init: ## 初始化 Vault（PKI + JWT Keys + Secrets）
	@echo "$(YELLOW)▶ 初始化 Vault...$(RESET)"
	@bash scripts/init-vault.sh
	@echo "$(GREEN)✅ Vault 初始化完成$(RESET)"

.PHONY: vault-status
vault-status: ## 查看 Vault 狀態
	@$(COMPOSE) -f $(COMPOSE_FILE) exec vault vault status

# ═══════════════════════════════════════════════════════════════
#  PROTOBUF
# ═══════════════════════════════════════════════════════════════
.PHONY: proto-gen
proto-gen: ## 從 .proto 產生 Go + TypeScript 程式碼
	@echo "$(YELLOW)▶ 產生 Protobuf 程式碼...$(RESET)"
	@bash scripts/gen-proto.sh
	@echo "$(GREEN)✅ Protobuf 程式碼產生完成$(RESET)"

# ═══════════════════════════════════════════════════════════════
#  TESTING
# ═══════════════════════════════════════════════════════════════
.PHONY: test
test: ## 執行所有服務單元測試
	@echo "$(YELLOW)▶ 執行 Go 服務測試...$(RESET)"
	@for svc in policy-engine manager/services/auth manager/services/registry; do \
	  [ -f $$svc/go.mod ] && (cd $$svc && go test ./... -v -coverprofile=coverage.out) || true; \
	done
	@echo "$(YELLOW)▶ 執行 Node.js 服務測試...$(RESET)"
	@[ -f gateway/package.json ]   && cd gateway     && npm test || true
	@[ -f manager/bff/package.json ] && cd manager/bff && npm test || true
	@[ -f studio/package.json ]    && cd studio      && npm test || true

.PHONY: test-e2e
test-e2e: ## 執行 E2E 整合測試（需所有服務運行）
	@echo "$(YELLOW)▶ 執行 E2E 測試...$(RESET)"
	@node --test tests/e2e/*.test.mjs

.PHONY: load-test
load-test: ## 執行 K6 壓力測試
	@echo "$(YELLOW)▶ 執行壓力測試...$(RESET)"
	@docker run --rm --network=xcloudapim_apim-net \
	  -e AUTH_URL=http://auth-service:8081 \
	  -e REGISTRY_URL=http://registry-service:8082 \
	  -e BFF_URL=http://bff:4000 \
	  -e GW_URL=http://gateway:8080 \
	  -e TEST_API_KEY=$${TEST_API_KEY:-xcapim_dev_key_1234567890} \
	  -e TEST_PATH=$${TEST_PATH:-/dev/echo/v1/anything} \
	  -v $(PWD)/load-tests:/scripts:ro grafana/k6 run /scripts/scenarios/smoke.js

# ═══════════════════════════════════════════════════════════════
#  LINT & FORMAT
# ═══════════════════════════════════════════════════════════════
.PHONY: lint
lint: ## 執行所有 linter
	@echo "$(YELLOW)▶ Go lint...$(RESET)"
	@which golangci-lint && golangci-lint run ./... || echo "  ⚠️  golangci-lint 未安裝"
	@echo "$(YELLOW)▶ Node.js lint...$(RESET)"
	@[ -f gateway/package.json ] && cd gateway && npm run lint || true
	@[ -f studio/package.json ]  && cd studio  && npm run lint || true
	@[ -f portal/package.json ]  && cd portal  && npm run lint || true

.PHONY: fmt
fmt: ## 格式化所有程式碼
	@echo "$(YELLOW)▶ Go fmt...$(RESET)"
	@find . -name "*.go" -not -path "*/vendor/*" | xargs gofmt -w
	@echo "$(YELLOW)▶ Prettier...$(RESET)"
	@[ -f studio/package.json ] && cd studio && npx prettier --write "src/**/*.{ts,tsx}" || true
	@[ -f portal/package.json ] && cd portal && npx prettier --write "app/**/*.{ts,tsx}" || true

# ═══════════════════════════════════════════════════════════════
#  GATEWAY
# ═══════════════════════════════════════════════════════════════
.PHONY: bff-build
bff-build: ## 建置 BFF Docker image
	@echo "$(YELLOW)▶ 建置 bff image [$(IMAGE_TAG)]...$(RESET)"
	@$(COMPOSE) -f $(COMPOSE_FILE) build \
	  --build-arg BUILD_DATE="$(BUILD_DATE)" \
	  --build-arg GIT_COMMIT="$(GIT_COMMIT)" \
	  bff
	@echo "$(GREEN)✅ bff image 建置完成$(RESET)"

.PHONY: bff-up
bff-up: ## 啟動 BFF 容器
	@$(COMPOSE) -f $(COMPOSE_FILE) up -d bff

.PHONY: bff-dev
bff-dev: ## 在本機以 tsx watch 啟動 BFF（開發用）
	@cd manager/bff && npm run dev

.PHONY: bff-logs
bff-logs: ## 追蹤 BFF 容器 logs
	@$(COMPOSE) -f $(COMPOSE_FILE) logs -f bff

.PHONY: portal-build
portal-build: ## 建置 Developer Portal Docker image
	@echo "$(YELLOW)▶ 建置 portal image [$(IMAGE_TAG)]...$(RESET)"
	@$(COMPOSE) -f $(COMPOSE_FILE) build \
	  --build-arg BUILD_DATE="$(BUILD_DATE)" \
	  --build-arg GIT_COMMIT="$(GIT_COMMIT)" \
	  portal
	@echo "$(GREEN)✓ portal image 完成$(RESET)"

.PHONY: portal-up
portal-up: ## 啟動 Developer Portal 容器
	@$(COMPOSE) -f $(COMPOSE_FILE) up -d portal

.PHONY: portal-dev
portal-dev: ## 在本機以 next dev 啟動 Developer Portal（開發用）
	@cd portal && npm run dev

.PHONY: portal-logs
portal-logs: ## 追蹤 Developer Portal 容器 logs
	@$(COMPOSE) -f $(COMPOSE_FILE) logs -f portal

.PHONY: studio-build
studio-build: ## 建置 Policy Studio Docker image
	@echo "$(YELLOW)▶ 建置 studio image [$(IMAGE_TAG)]...$(RESET)"
	@$(COMPOSE) -f $(COMPOSE_FILE) build \
	  --build-arg BUILD_DATE="$(BUILD_DATE)" \
	  --build-arg GIT_COMMIT="$(GIT_COMMIT)" \
	  studio
	@echo "$(GREEN)✓ studio image 完成$(RESET)"

.PHONY: studio-up
studio-up: ## 啟動 Policy Studio 容器
	@$(COMPOSE) -f $(COMPOSE_FILE) up -d studio

.PHONY: studio-dev
studio-dev: ## 在本機以 vite 啟動 Policy Studio（開發用）
	@cd studio && npm run dev

.PHONY: studio-logs
studio-logs: ## 追蹤 Policy Studio 容器 logs
	@$(COMPOSE) -f $(COMPOSE_FILE) logs -f studio

.PHONY: gateway-build
gateway-build: ## 建置 gateway Docker image（含 BUILD_DATE / GIT_COMMIT labels）
	@echo "$(YELLOW)▶ 建置 gateway image [$(IMAGE_TAG)]...$(RESET)"
	@$(COMPOSE) -f $(COMPOSE_FILE) build \
	  --build-arg BUILD_DATE="$(BUILD_DATE)" \
	  --build-arg GIT_COMMIT="$(GIT_COMMIT)" \
	  gateway
	@echo "$(GREEN)✅ gateway image 建置完成$(RESET)"

.PHONY: gateway-up
gateway-up: ## 啟動 gateway 容器（依賴 Redis 已就緒）
	@$(COMPOSE) -f $(COMPOSE_FILE) up -d gateway

.PHONY: gateway-dev
gateway-dev: ## 在本機以 tsx watch 啟動 gateway（開發用）
	@cd gateway && npm run dev

.PHONY: gateway-typecheck
gateway-typecheck: ## 執行 gateway TypeScript 型別檢查
	@cd gateway && npm run typecheck

.PHONY: gateway-logs
gateway-logs: ## 追蹤 gateway 容器 logs
	@$(COMPOSE) -f $(COMPOSE_FILE) logs -f gateway

# ═══════════════════════════════════════════════════════════════
#  PRODUCTION
# ═══════════════════════════════════════════════════════════════
.PHONY: prod-up
prod-up: ## 以生產設定啟動服務（overlay docker-compose.prod.yml）
	@$(COMPOSE) -f $(COMPOSE_FILE) -f $(COMPOSE_PROD) up -d

.PHONY: prod-down
prod-down: ## 停止生產服務
	@$(COMPOSE) -f $(COMPOSE_FILE) -f $(COMPOSE_PROD) down

.PHONY: test-env-up
test-env-up: ## 啟動最小化測試環境（CI 整合測試用）
	@echo "$(YELLOW)▶ 啟動測試環境...$(RESET)"
	@$(COMPOSE) -f $(COMPOSE_TEST) up -d
	@echo "$(GREEN)✅ 測試環境啟動完成$(RESET)"

.PHONY: test-env-down
test-env-down: ## 停止並移除測試環境
	@$(COMPOSE) -f $(COMPOSE_TEST) down -v

# ═══════════════════════════════════════════════════════════════
#  CLEAN
# ═══════════════════════════════════════════════════════════════
.PHONY: clean
clean: ## 清除所有 build artifacts
	@echo "$(YELLOW)▶ 清除 build artifacts...$(RESET)"
	@find . -name "dist" -type d -not -path "*/node_modules/*" | xargs rm -rf
	@find . -name ".next" -type d | xargs rm -rf
	@find . -name "*.out" -type f | xargs rm -f
	@find . -name "coverage" -type d | xargs rm -rf
	@echo "$(GREEN)✅ 清除完成$(RESET)"

.PHONY: prune
prune: ## 清除未使用的 Docker 資源
	@docker system prune -f
	@docker volume prune -f

.PHONY: .env
.env:
	@[ -f .env ] || (cp .env.example .env && echo "$(YELLOW)⚠️  已從 .env.example 建立 .env，請填入設定值$(RESET)")

# ═══════════════════════════════════════════════════════════════
#  K6 LOAD TESTS
# ═══════════════════════════════════════════════════════════════
K6_COMPOSE := -f $(COMPOSE_FILE) -f load-tests/docker-compose.k6.yml
K6_ENVS    := TEST_API_KEY=$(TEST_API_KEY) TEST_PATH=$(or $(TEST_PATH),/dev/echo/v1/anything) TARGET_API_ID=$(TARGET_API_ID)

.PHONY: k6-infra-up
k6-infra-up: ## 啟動 InfluxDB（K6 metrics store）
	@echo "$(YELLOW)▶ 啟動 InfluxDB for K6...$(RESET)"
	@$(COMPOSE) $(K6_COMPOSE) up -d influxdb-k6
	@echo "$(GREEN)✅ InfluxDB 啟動完成（http://localhost:8086）$(RESET)"

.PHONY: k6-smoke
k6-smoke: k6-infra-up ## 執行 Smoke Test（1 VU, 2 min — CI gate）
	@echo "$(YELLOW)▶ K6 Smoke Test...$(RESET)"
	@$(COMPOSE) $(K6_COMPOSE) run --rm \
	  -e TEST_API_KEY=$(or $(TEST_API_KEY),xcapim_dev_key_1234567890) \
	  -e TEST_PATH=$(or $(TEST_PATH),/dev/echo/v1/anything) \
	  k6 run /scripts/scenarios/smoke.js
	@echo "$(GREEN)✅ Smoke Test 完成$(RESET)"

.PHONY: k6-load
k6-load: k6-infra-up ## 執行 Load Test（50→100 VU, 9 min）
	@echo "$(YELLOW)▶ K6 Load Test...$(RESET)"
	@$(COMPOSE) $(K6_COMPOSE) run --rm \
	  -e TEST_API_KEY=$(or $(TEST_API_KEY),xcapim_dev_key_1234567890) \
	  -e TEST_PATH=$(or $(TEST_PATH),/dev/echo/v1/anything) \
	  -e TARGET_API_ID=$(TARGET_API_ID) \
	  k6 run /scripts/scenarios/load.js
	@echo "$(GREEN)✅ Load Test 完成$(RESET)"

.PHONY: k6-stress
k6-stress: k6-infra-up ## 執行 Stress Test（破壞點測試，最高 400 VU）
	@echo "$(YELLOW)▶ K6 Stress Test — 此測試會讓系統超載$(RESET)"
	@$(COMPOSE) $(K6_COMPOSE) run --rm \
	  -e TEST_API_KEY=$(or $(TEST_API_KEY),xcapim_dev_key_1234567890) \
	  -e TEST_PATH=$(or $(TEST_PATH),/dev/echo/v1/anything) \
	  k6 run /scripts/scenarios/stress.js

.PHONY: k6-soak
k6-soak: k6-infra-up ## 執行 Soak Test（20 VU, 2h 耐久）
	@echo "$(YELLOW)▶ K6 Soak Test（預設 2h，可用 DURATION=30m 覆蓋）...$(RESET)"
	@$(COMPOSE) $(K6_COMPOSE) run --rm \
	  -e TEST_API_KEY=$(or $(TEST_API_KEY),xcapim_dev_key_1234567890) \
	  -e TEST_PATH=$(or $(TEST_PATH),/dev/echo/v1/anything) \
	  -e DURATION=$(or $(DURATION),2h) \
	  k6 run /scripts/scenarios/soak.js

.PHONY: k6-flow
k6-flow: k6-infra-up ## 執行 API Flow Test（端對端使用者旅程）
	@echo "$(YELLOW)▶ K6 API Flow Test...$(RESET)"
	@$(COMPOSE) $(K6_COMPOSE) run --rm \
	  -e TEST_PATH=$(or $(TEST_PATH),/dev/echo/v1/anything) \
	  k6 run /scripts/scenarios/api-flow.js

.PHONY: k6-report
k6-report: ## 開啟 Grafana K6 Results Dashboard
	@open http://localhost:3002/d/apim-k6-results || xdg-open http://localhost:3002/d/apim-k6-results

# ═══════════════════════════════════════════════════════════════
#  OBSERVABILITY
# ═══════════════════════════════════════════════════════════════
.PHONY: obs-up
obs-up: ## 啟動完整 Observability stack（Prometheus + Grafana + Jaeger + Alertmanager）
	@echo "$(YELLOW)▶ 啟動 Observability Stack...$(RESET)"
	@$(COMPOSE) -f $(COMPOSE_FILE) up -d prometheus grafana jaeger alertmanager influxdb-k6
	@echo "$(GREEN)✅ Observability Stack 啟動完成$(RESET)"
	@echo "  Grafana:      http://localhost:3002  (admin / GF_SECURITY_ADMIN_PASSWORD)"
	@echo "  Prometheus:   http://localhost:9090"
	@echo "  Alertmanager: http://localhost:9093"
	@echo "  Jaeger:       http://localhost:16686"
	@echo "  InfluxDB:     http://localhost:8086"

.PHONY: obs-reload
obs-reload: ## 熱重載 Prometheus 設定（不重啟容器）
	@curl -s -X POST http://localhost:9090/-/reload && echo "$(GREEN)✅ Prometheus 設定已重載$(RESET)"

.PHONY: alerts
alerts: ## 列出目前觸發中的 Prometheus alerts
	@curl -s http://localhost:9090/api/v1/alerts | \
	  python3 -c "import sys,json; alerts=json.load(sys.stdin)['data']['alerts']; \
	  [print(f\"[{a['labels']['severity'].upper()}] {a['labels']['alertname']}: {a['annotations'].get('summary','')}\") for a in alerts] \
	  if alerts else print('No active alerts')"

.PHONY: exporters-up
exporters-up: ## 啟動所有 Prometheus exporters
	@$(COMPOSE) -f $(COMPOSE_FILE) up -d postgres-exporter redis-exporter node-exporter nginx-exporter kafka-exporter
	@echo "$(GREEN)✅ Exporters 啟動$(RESET)"

# ═══════════════════════════════════════════════════════════════
#  CI (local simulation)
# ═══════════════════════════════════════════════════════════════
.PHONY: typecheck
typecheck: ## TypeScript 型別檢查（gateway, bff, studio, portal）
	@echo "$(YELLOW)▶ Type checking...$(RESET)"
	@for svc in gateway manager/bff studio portal manager/services/analytics manager/services/notification; do \
	  echo "  → $$svc"; \
	  cd $$svc && npm run typecheck --if-present && cd - > /dev/null; \
	done
	@echo "$(GREEN)✅ Typecheck 完成$(RESET)"

.PHONY: test-go
test-go: ## 執行所有 Go 服務的單元測試（本機預設不開 race；GO_TEST_RACE=1 可啟用）
	@echo "$(YELLOW)▶ Go tests...$(RESET)"
	@bash scripts/go-test.sh
	@echo "$(GREEN)✅ Go tests 完成$(RESET)"

.PHONY: ci-local
ci-local: lint typecheck test-go ## 本地模擬 CI（lint + typecheck + test-go）
	@echo "$(GREEN)✅ Local CI 完成$(RESET)"

# ─── Release helpers ─────────────────────────────────────────
.PHONY: tag
tag: ## 建立新版本 tag（用法：make tag VERSION=1.2.3）
	@[ -n "$(VERSION)" ] || (echo "❌ 請指定 VERSION，例如：make tag VERSION=1.2.3" && exit 1)
	@git tag -a "v$(VERSION)" -m "Release v$(VERSION)"
	@echo "$(GREEN)✅ Tag v$(VERSION) 建立完成，推送用：git push origin v$(VERSION)$(RESET)"

.PHONY: changelog
changelog: ## 顯示從上一個 tag 到現在的 commit log
	@PREV=$$(git tag --sort=-version:refname | head -1); \
	  if [ -n "$$PREV" ]; then \
	    echo "$(CYAN)Changes since $$PREV:$(RESET)"; \
	    git log "$$PREV..HEAD" --pretty=format:"  %C(yellow)%h%Creset %s" --no-merges; \
	  else \
	    echo "$(CYAN)All commits (no previous tag):$(RESET)"; \
	    git log --pretty=format:"  %C(yellow)%h%Creset %s" --no-merges | head -30; \
	  fi
