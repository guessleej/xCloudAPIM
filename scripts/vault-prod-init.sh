#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  vault-prod-init.sh — Vault Production Mode 初始化腳本
#  在 vault-init container 啟動時自動執行
#  流程：operator init → unseal (3-of-5) → 設定 KV/PKI secrets
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

VAULT_ADDR="${VAULT_ADDR:-http://vault:8200}"
INIT_FILE="/vault/data/.init_keys"

export VAULT_ADDR

# 注意：vault status 對「未初始化/封印」回傳 exit code 2；在 `set -o pipefail`
# 下，`vault status | grep` 會因此被視為失敗。故一律先以 `|| true` 擷取輸出，
# 再對輸出做判斷，避免 pipefail 造成永遠等待。
wait_vault() {
  local max=30 out
  for i in $(seq 1 $max); do
    out=$(vault status -format=json 2>/dev/null || true)
    if printf '%s' "$out" | grep -q '"initialized"'; then
      return 0
    fi
    echo "⏳ Waiting for Vault... ($i/$max)"
    sleep 3
  done
  echo "❌ Vault not reachable after ${max} attempts"
  exit 1
}

wait_vault

# 以 grep/sed 解析 JSON（不依賴 python3，避免 runtime apk 失敗導致中斷）
json_bool() { grep -oE "\"$1\"[[:space:]]*:[[:space:]]*(true|false)" | grep -oE "(true|false)" | head -1; }

IS_INITIALIZED=$(vault status -format=json 2>/dev/null | json_bool initialized || true)
[ -z "$IS_INITIALIZED" ] && IS_INITIALIZED=false

if [ "$IS_INITIALIZED" = "false" ]; then
  echo "▶ Initializing Vault (5 shares, 3 threshold)..."
  # 寫入暫存檔再 mv：避免 init 失敗時 redirect 清空既有金鑰檔（曾導致 unseal key 遺失）
  if vault operator init -key-shares=5 -key-threshold=3 -format=json > "${INIT_FILE}.tmp" && [ -s "${INIT_FILE}.tmp" ]; then
    mv "${INIT_FILE}.tmp" "$INIT_FILE"
    chmod 600 "$INIT_FILE"
  else
    rm -f "${INIT_FILE}.tmp"
    echo "❌ vault operator init failed（vault 可能已初始化但 .init_keys 遺失）"
    exit 1
  fi
  echo "✅ Init keys saved to $INIT_FILE — BACK THIS UP SECURELY!"

  # 自動 unseal（取前 3 把 b64 金鑰；grep/sed 解析）
  UNSEAL_KEYS=$(sed -n '/"unseal_keys_b64"/,/]/p' "$INIT_FILE" | grep -oE '"[A-Za-z0-9+/=]{40,}"' | tr -d '"' | head -3)
  for KEY in $UNSEAL_KEYS; do
    vault operator unseal "$KEY" >/dev/null
  done

  ROOT_TOKEN=$(grep -o '"root_token"[[:space:]]*:[[:space:]]*"[^"]*"' "$INIT_FILE" | sed 's/.*"root_token"[[:space:]]*:[[:space:]]*"//; s/"$//')
  export VAULT_TOKEN="$ROOT_TOKEN"
  echo "✅ Vault unsealed with root token"
else
  echo "▶ Vault already initialized"
  IS_SEALED=$(vault status -format=json 2>/dev/null | json_bool sealed || true)
  [ -z "$IS_SEALED" ] && IS_SEALED=true
  if [ "$IS_SEALED" = "true" ]; then
    echo "⚠️  Vault is sealed — automatic unseal is disabled in production mode"
    echo "    Run: vault operator unseal <key1> && vault operator unseal <key2> && vault operator unseal <key3>"
    exit 0
  fi
  export VAULT_TOKEN="${VAULT_TOKEN:?VAULT_TOKEN is required for already-initialized Vault}"
fi

# ─── KV v2 Secrets Engine ─────────────────────────────────────
echo "▶ Enabling KV v2 secrets engine..."
vault secrets enable -path=secret -version=2 kv 2>/dev/null || echo "  (already enabled)"

# ─── JWT Key Pair（RSA 2048）──────────────────────────────────
echo "▶ Generating RSA JWT key pair..."
TMP_DIR=$(mktemp -d)
openssl genrsa -out "$TMP_DIR/jwt_private.pem" 2048 2>/dev/null
openssl rsa -in "$TMP_DIR/jwt_private.pem" -pubout -out "$TMP_DIR/jwt_public.pem" 2>/dev/null

vault kv put secret/jwt \
  private_key_pem="$(base64 < "$TMP_DIR/jwt_private.pem")" \
  public_key_pem="$(base64 < "$TMP_DIR/jwt_public.pem")"

rm -rf "$TMP_DIR"
echo "✅ JWT key pair stored at secret/jwt"

# ─── Database Credentials ─────────────────────────────────────
echo "▶ Storing database credentials..."
vault kv put secret/database \
  postgres_host="${POSTGRES_HOST:-postgres}" \
  postgres_db="${POSTGRES_DB:-apim}" \
  postgres_user="${POSTGRES_USER:-apim_user}" \
  postgres_password="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}" \
  redis_host="${REDIS_HOST:-redis-master-1}" \
  redis_password="${REDIS_PASSWORD:?REDIS_PASSWORD is required}"
echo "✅ Database credentials stored at secret/database"

# ─── Database Secrets Engine（動態簽發 postgres 帳密，P2-B-2）──────
echo "▶ Configuring database secrets engine..."
vault secrets enable -path=database database 2>/dev/null || echo "  (database engine already enabled)"
# Vault 以 apim_user（postgres image 預設為 superuser，可 CREATE ROLE）連線管理動態帳號
# postgres 已啟用 TLS（P2-A）→ 連線需 sslmode=require
vault write database/config/apim-postgres \
  plugin_name=postgresql-database-plugin \
  allowed_roles="apim-dyn" \
  connection_url="postgresql://{{username}}:{{password}}@${POSTGRES_HOST:-postgres}:5432/${POSTGRES_DB:-apim}?sslmode=require" \
  username="${POSTGRES_USER:-apim_user}" \
  password="${POSTGRES_PASSWORD}" >/dev/null
# 角色：建立臨時 LOGIN 角色並授予 public schema 權限；default 24h、max 168h
vault write database/roles/apim-dyn \
  db_name=apim-postgres \
  creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; GRANT USAGE ON SCHEMA public TO \"{{name}}\"; GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO \"{{name}}\"; GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO \"{{name}}\";" \
  revocation_statements="REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM \"{{name}}\"; REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM \"{{name}}\"; REVOKE USAGE ON SCHEMA public FROM \"{{name}}\"; DROP ROLE IF EXISTS \"{{name}}\";" \
  default_ttl="24h" \
  max_ttl="168h" >/dev/null
echo "✅ Database secrets engine ready (role: apim-dyn)"

# ─── Internal Service Secret ──────────────────────────────────
if [[ -n "${INTERNAL_SERVICE_SECRET:-}" ]]; then
  vault kv put secret/internal \
    service_secret="$INTERNAL_SERVICE_SECRET"
  echo "✅ Internal service secret stored at secret/internal"
fi

# ─── Policy for services ──────────────────────────────────────
echo "▶ Creating Vault policy for API services..."
vault policy write apim-service - <<'POLICY'
path "secret/data/jwt" {
  capabilities = ["read"]
}
path "secret/data/database" {
  capabilities = ["read"]
}
path "secret/data/internal" {
  capabilities = ["read"]
}
path "database/creds/apim-dyn" {
  capabilities = ["read"]
}
path "sys/leases/renew" {
  capabilities = ["update"]
}
POLICY
echo "✅ Policy 'apim-service' created"

echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  ✅ Vault Production Init Complete         ║"
echo "║  Root token:  $INIT_FILE                  ║"
echo "║  ⚠️  SECURE AND DELETE root token ASAP!   ║"
echo "╚════════════════════════════════════════════╝"
