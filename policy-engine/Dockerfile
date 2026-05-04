# ─── Build Stage ──────────────────────────────────────────────
FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-w -s" \
    -o /bin/policy-engine \
    ./cmd/server

# ─── Runtime Stage ────────────────────────────────────────────
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata && \
    addgroup -S appgroup && \
    adduser  -S appuser -G appgroup -u 1001

COPY --from=builder /bin/policy-engine /bin/policy-engine

USER appuser

EXPOSE 8083 50051

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:8083/healthz || exit 1

ENTRYPOINT ["/bin/policy-engine"]
