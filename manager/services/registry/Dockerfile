# ─── Stage 1: Builder ─────────────────────────────────────────
FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download && go mod verify

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build \
    -ldflags="-w -s" \
    -trimpath \
    -o /build/registry-service \
    ./cmd/server

# ─── Stage 2: Runtime ─────────────────────────────────────────
FROM alpine:3.19

RUN addgroup -g 1001 -S appgroup && \
    adduser  -u 1001 -S appuser -G appgroup

RUN apk add --no-cache ca-certificates tzdata curl
ENV TZ=Asia/Taipei

WORKDIR /app
COPY --from=builder /build/registry-service ./registry-service
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

RUN chown -R appuser:appgroup /app && chmod 550 /app/registry-service

USER appuser
EXPOSE 8082

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS http://localhost:8082/health | grep -q '"status":"ok"' || exit 1

ENTRYPOINT ["./registry-service"]
