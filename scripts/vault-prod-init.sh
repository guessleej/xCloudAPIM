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

wait_vault() {
  local max=30
  for i in $(seq 1 $max); do
    if vault status -format=json 2>/dev/null | grep -q '"initialized"'; then
      return 0
    fi
    echo "⏳ Waiting for Vault... ($i/$max)"
    sleep 3
  done
  echo "❌ Vault not reachable after ${max} attempts"
  exit 1
}

wait_vault

IS_INITIALIZED=$(vault status -format=json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['initialized'])" 2>/dev/null || echo "false")

if [[ "$IS_INITIALIZED" == "False" || "$IS_INITIALIZED" == "false" ]]; then
  echo "▶ Initializing Vault (5 shares, 3 threshold)..."
  vault operator init \
    -key-shares=5 \
    -key-threshold=3 \
    -format=json > "$INIT_FILE"
  chmod 600 "$INIT_FILE"
  echo "✅ Init keys saved to $INIT_FILE — BACK THIS UP SECURELY!"

  # 自動 unseal（僅開發用 — 生產環境應人工 unseal 或用 AWS KMS auto-unseal）
  for i in 0 1 2; do
    KEY=$(python3 -c "import sys,json; print(json.load(open('$INIT_FILE'))['unseal_keys_b64'][$i])")
    vault operator unseal "$KEY"
  done

  ROOT_TOKEN=$(python3 -c "import sys,json; print(json.load(open('$INIT_FILE'))['root_token'])")
  export VAULT_TOKEN="$ROOT_TOKEN"
  echo "✅ Vault unsealed with root token"
else
  echo "▶ Vault already initialized"
  IS_SEALED=$(vault status -format=json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['sealed'])" 2>/dev/null || echo "true")
  if [[ "$IS_SEALED" == "True" || "$IS_SEALED" == "true" ]]; then
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
POLICY
echo "✅ Policy 'apim-service' created"

echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  ✅ Vault Production Init Complete         ║"
echo "║  Root token:  $INIT_FILE                  ║"
echo "║  ⚠️  SECURE AND DELETE root token ASAP!   ║"
echo "╚════════════════════════════════════════════╝"
