# ═══════════════════════════════════════════════════════════════
#  Auth Service Dockerfile — Multi-Stage Build
#  Stage 1: Build (golang:1.22-alpine)
#  Stage 2: Runtime (alpine:3.19)
# ═══════════════════════════════════════════════════════════════

# ─── Stage 1: Builder ─────────────────────────────────────────
FROM golang:1.22-alpine AS builder

# 安裝 build 依賴
RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /build

# 先複製 go.mod / go.sum 利用 Layer Cache
COPY go.mod go.sum ./
RUN go mod download && go mod verify

# 複製原始碼
COPY . .

# 編譯（靜態 binary，關閉 CGO）
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build \
    -ldflags="-w -s -X main.Version=$(git describe --tags --always 2>/dev/null || echo dev)" \
    -trimpath \
    -o /build/auth-service \
    ./cmd/server

# 驗證 binary
RUN /build/auth-service --help 2>/dev/null || true

# ─── Stage 2: Runtime ─────────────────────────────────────────
FROM alpine:3.19

# 安全：不以 root 執行
RUN addgroup -g 1001 -S appgroup && \
    adduser  -u 1001 -S appuser -G appgroup

# 安裝最小執行依賴
RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    curl

# 設定時區
ENV TZ=Asia/Taipei

WORKDIR /app

# 複製 binary 與 CA 憑證
COPY --from=builder /build/auth-service  ./auth-service
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

# 設定權限
RUN chown -R appuser:appgroup /app && \
    chmod 550 /app/auth-service

USER appuser

# 暴露 HTTP Port
EXPOSE 8081

# 健康檢查
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS http://localhost:8081/health | grep -q '"status":"ok"' || exit 1

# 啟動
ENTRYPOINT ["./auth-service"]
