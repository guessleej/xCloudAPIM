#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  gen-certs.sh — 產生本地開發用 TLS 憑證（使用 mkcert）
#  用法：bash scripts/gen-certs.sh
#  輸出：infra/nginx/certs/apim.crt + apim.key
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

CERT_DIR="infra/nginx/certs"
mkdir -p "$CERT_DIR"

DOMAINS=(
  localhost
  "*.apim.local"
  apim.local
  api.apim.local
  bff.apim.local
  studio.apim.local
  portal.apim.local
  grafana.apim.local
  kibana.apim.local
  jaeger.apim.local
)

if command -v mkcert &>/dev/null; then
  echo "▶ 使用 mkcert 產生受信任本地憑證..."
  mkcert -install 2>/dev/null || true
  mkcert -cert-file "$CERT_DIR/apim.crt" \
         -key-file  "$CERT_DIR/apim.key" \
         "${DOMAINS[@]}"
  echo "✅ mkcert 憑證已產生：$CERT_DIR/apim.crt"
elif command -v openssl &>/dev/null; then
  echo "▶ mkcert 未安裝，使用 openssl 產生自簽憑證（瀏覽器會顯示警告）..."
  echo "  建議安裝 mkcert：brew install mkcert"
  DOMAIN_LIST=$(IFS=,; echo "${DOMAINS[*]}")
  SAN="subjectAltName=DNS:localhost,DNS:*.apim.local,DNS:apim.local"
  openssl req -x509 -nodes -days 365 \
    -newkey rsa:2048 \
    -keyout "$CERT_DIR/apim.key" \
    -out    "$CERT_DIR/apim.crt" \
    -subj "/C=TW/ST=Taiwan/L=Taipei/O=xCloudAPIM/CN=*.apim.local" \
    -addext "$SAN" 2>/dev/null
  echo "✅ openssl 自簽憑證已產生：$CERT_DIR/apim.crt"
else
  echo "❌ 需要 mkcert 或 openssl"
  exit 1
fi

chmod 644 "$CERT_DIR/apim.crt"
chmod 600 "$CERT_DIR/apim.key"

# 加入 /etc/hosts（若尚未存在）
echo ""
echo "▶ 建議將以下行加入 /etc/hosts（需要 sudo）："
echo "  127.0.0.1  api.apim.local bff.apim.local studio.apim.local"
echo "  127.0.0.1  portal.apim.local grafana.apim.local"
echo "  127.0.0.1  kibana.apim.local jaeger.apim.local"
echo ""
echo "  快速執行：sudo bash scripts/setup-hosts.sh"
