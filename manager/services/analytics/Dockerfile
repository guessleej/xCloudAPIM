# ─── Build Stage ──────────────────────────────────────────────────────────────
FROM node:20.14.0-alpine3.19 AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build || true
RUN npm ci --omit=dev --ignore-scripts

# ─── Runtime Stage ────────────────────────────────────────────────────────────
FROM node:20.14.0-alpine3.19 AS runtime
RUN apk add --no-cache dumb-init=1.2.5-r3 curl && \
    addgroup -S appgroup -g 1001 && \
    adduser  -S appuser -G appgroup -u 1001 -H -s /sbin/nologin
WORKDIR /app
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/dist         ./dist
COPY --from=builder --chown=appuser:appgroup /app/package.json ./
ARG BUILD_DATE
ARG GIT_COMMIT
LABEL org.opencontainers.image.title="xCloudAPIM Analytics Service" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${GIT_COMMIT}"
USER appuser
EXPOSE 8085
ENV NODE_ENV=production NODE_OPTIONS="--max-old-space-size=512 --enable-source-maps"
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fs http://localhost:8085/healthz || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/app.js"]
