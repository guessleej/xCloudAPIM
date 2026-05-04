# ── Stage 1: build ───────────────────────────────────────────────
FROM node:20.14.0-alpine3.19 AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx vite build

# ── Stage 2: serve ───────────────────────────────────────────────
FROM nginx:1.27.0-alpine AS runner

ARG BUILD_DATE
ARG GIT_COMMIT

LABEL org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      org.opencontainers.image.title="xCloudAPIM Policy Studio" \
      org.opencontainers.image.vendor="xCloudAPIM"

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
