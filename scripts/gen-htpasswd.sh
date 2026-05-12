#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  gen-htpasswd.sh — 產生管理介面 Nginx Basic Auth 密碼檔
#  用法：bash scripts/gen-htpasswd.sh
#  輸出：infra/nginx/auth/.htpasswd
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

HTPASSWD_FILE="infra/nginx/auth/.htpasswd"
mkdir -p "$(dirname "$HTPASSWD_FILE")"

ADMIN_USER="${MGMT_ADMIN_USER:-admin}"
ADMIN_PASS="${MGMT_ADMIN_PASSWORD:-}"

if [[ -z "$ADMIN_PASS" ]]; then
  echo "❌ 請設定 MGMT_ADMIN_PASSWORD 環境變數後重試"
  echo "   例：MGMT_ADMIN_PASSWORD=yourpassword bash scripts/gen-htpasswd.sh"
  exit 1
fi

# 優先用 htpasswd（apache2-utils），退而用 openssl apr1
if command -v htpasswd &>/dev/null; then
  htpasswd -bBc "$HTPASSWD_FILE" "$ADMIN_USER" "$ADMIN_PASS"
elif command -v openssl &>/dev/null; then
  HASH=$(openssl passwd -apr1 "$ADMIN_PASS")
  printf '%s:%s\n' "$ADMIN_USER" "$HASH" > "$HTPASSWD_FILE"
else
  echo "❌ 需要 htpasswd 或 openssl，請安裝 apache2-utils"
  exit 1
fi

chmod 600 "$HTPASSWD_FILE"
echo "✅ htpasswd 已產生：$HTPASSWD_FILE（使用者：$ADMIN_USER）"
