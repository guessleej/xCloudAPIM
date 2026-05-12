# ─── Build Stage ──────────────────────────────────────────────────────────────
FROM node:20.19-alpine AS builder

WORKDIR /app

# 先只複製套件描述檔，利用 Docker layer cache
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# 複製原始碼並編譯
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# 僅保留 production 依賴（去除 devDependencies）
RUN npm ci --omit=dev --ignore-scripts

# ─── Runtime Stage ────────────────────────────────────────────────────────────
FROM node:20.19-alpine AS runtime

# 安裝 dumb-init（PID 1 信號轉發）+ curl（健康檢查備援）
RUN apk add --no-cache dumb-init=1.2.5-r3 curl && \
    addgroup -S appgroup -g 1001 && \
    adduser  -S appuser  -G appgroup -u 1001 -H -s /sbin/nologin

WORKDIR /app

# 複製 production artifacts
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/dist         ./dist
COPY --from=builder --chown=appuser:appgroup /app/package.json ./

# OCI 標準 labels
ARG BUILD_DATE
ARG GIT_COMMIT
LABEL org.opencontainers.image.title="xCloudAPIM API Gateway" \
      org.opencontainers.image.description="Fastify v4 / Node.js 20 API Gateway" \
      org.opencontainers.image.vendor="xCloudAPIM" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      org.opencontainers.image.version="1.0.0"

USER appuser

EXPOSE 8080

# --max-old-space-size 限制 heap，避免 OOM Kill 前無預警
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=512 --enable-source-maps"

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fs http://localhost:8080/healthz || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/app.js"]
