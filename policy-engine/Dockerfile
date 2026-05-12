# ═══════════════════════════════════════════════════════════════
#  Policy Engine Dockerfile — Multi-Stage Build
# ═══════════════════════════════════════════════════════════════

FROM golang:1.25-alpine AS builder

ARG BUILD_DATE
ARG GIT_COMMIT

RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download && go mod verify

COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build \
    -ldflags="-w -s -X main.Version=${GIT_COMMIT:-dev} -X main.BuildDate=${BUILD_DATE:-unknown}" \
    -trimpath \
    -o /build/policy-engine \
    ./cmd/server

FROM alpine:3.19

RUN addgroup -g 1001 -S appgroup && \
    adduser  -u 1001 -S appuser -G appgroup

RUN apk add --no-cache ca-certificates tzdata wget

ENV TZ=Asia/Taipei

WORKDIR /app

COPY --from=builder /build/policy-engine         ./policy-engine
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

RUN chown -R appuser:appgroup /app && \
    chmod 550 /app/policy-engine

USER appuser

EXPOSE 8083

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- http://localhost:8083/healthz | grep -q '"status":"ok"' || exit 1

ENTRYPOINT ["./policy-engine"]
