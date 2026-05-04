#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  T04: xCloudAPIM Vault 初始化腳本
#  功能: PKI CA / KV v2 / JWT RS256 Key Pair / Transit 加密
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

VAULT_ADDR="${VAULT_ADDR:-http://localhost:8200}"
VAULT_TOKEN="${VAULT_TOKEN:-dev-root-token}"
export VAULT_ADDR VAULT_TOKEN

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; RESET='\033[0m'
log()  { echo -e "${CYAN}▶ $*${RESET}"; }
ok()   { echo -e "${GREEN}  ✅ $*${RESET}"; }
warn() { echo -e "${YELLOW}  ⚠️  $*${RESET}"; }
die()  { echo -e "${RED}  ❌ $*${RESET}"; exit 1; }

# ─── 等待 Vault 就緒 ─────────────────────────────────────────
wait_vault() {
  log "等待 Vault 就緒 ($VAULT_ADDR)..."
  local retries=30
  until vault status -format=json 2>/dev/null | grep -q '"initialized"'; do
    retries=$((retries - 1))
    [ $retries -eq 0 ] && die "Vault 啟動逾時"
    echo -n "."
    sleep 2
  done
  echo ""
  ok "Vault 已就緒"
}

# ─── 啟用 KV v2 Secrets Engine ───────────────────────────────
setup_kv() {
  log "設定 KV v2 Secrets Engine..."
  vault secrets enable -path=secret kv-v2 2>/dev/null \
    && ok "KV v2 已啟用於 secret/" \
    || warn "KV v2 已存在，跳過"
}

# ─── 啟用 PKI Secrets Engine + 建立 CA ───────────────────────
setup_pki() {
  log "設定 PKI Secrets Engine..."
  vault secrets enable pki 2>/dev/null \
    && ok "PKI 已啟用" \
    || warn "PKI 已存在，跳過"

  vault secrets tune -max-lease-ttl=87600h pki  # 10 years

  # 建立 Root CA
  log "建立 Root CA..."
  vault write -field=certificate pki/root/generate/internal \
    common_name="xCloudAPIM Root CA" \
    organization="xCloudAPIM" \
    country="TW" \
    ttl=87600h > /tmp/root_ca.crt 2>/dev/null \
    && ok "Root CA 建立完成" \
    || warn "Root CA 已存在，跳過"

  # 設定 CRL / OCSP URLs
  vault write pki/config/urls \
    issuing_certificates="${VAULT_ADDR}/v1/pki/ca" \
    crl_distribution_points="${VAULT_ADDR}/v1/pki/crl" \
    ocsp_servers="${VAULT_ADDR}/v1/pki/ocsp"

  # 建立 Intermediate CA
  log "建立 Intermediate CA..."
  vault secrets enable -path=pki_int pki 2>/dev/null \
    && ok "PKI Intermediate 已啟用" \
    || warn "PKI Intermediate 已存在，跳過"
  vault secrets tune -max-lease-ttl=43800h pki_int  # 5 years

  # 建立 Intermediate CSR
  local INT_CSR
  INT_CSR=$(vault write -field=csr pki_int/intermediate/generate/internal \
    common_name="xCloudAPIM Intermediate CA" \
    organization="xCloudAPIM" \
    ttl=43800h 2>/dev/null || true)

  if [ -n "$INT_CSR" ]; then
    # Root CA 簽署 Intermediate CSR
    local INT_CERT
    INT_CERT=$(vault write -field=certificate pki/root/sign-intermediate \
      csr="$INT_CSR" \
      common_name="xCloudAPIM Intermediate CA" \
      ttl=43800h format=pem_bundle)

    vault write pki_int/intermediate/set-signed certificate="$INT_CERT"
    ok "Intermediate CA 建立並簽署完成"
  fi

  # 建立服務憑證發行 Role
  log "建立 PKI Roles..."
  vault write pki_int/roles/apim-services \
    allowed_domains="xcloudapim.local,svc.cluster.local" \
    allow_subdomains=true \
    allow_bare_domains=false \
    max_ttl=720h \
    require_cn=true
  ok "PKI Role: apim-services"

  vault write pki_int/roles/apim-gateway \
    allowed_domains="gateway.xcloudapim.local" \
    allow_subdomains=false \
    max_ttl=8760h
  ok "PKI Role: apim-gateway"
}

# ─── JWT RS256 Key Pair ───────────────────────────────────────
setup_jwt_keys() {
  log "產生 JWT RS256 Key Pair（2048-bit）..."

  # 檢查是否已存在
  if vault kv get secret/jwt &>/dev/null; then
    warn "JWT Keys 已存在，跳過（如需輪換請執行 rotate-jwt-keys.sh）"
    return
  fi

  # 使用 openssl 產生 RSA 2048 key pair
  local PRIVATE_KEY_PEM PUBLIC_KEY_PEM KEY_ID
  PRIVATE_KEY_PEM=$(openssl genrsa 2048 2>/dev/null)
  PUBLIC_KEY_PEM=$(echo "$PRIVATE_KEY_PEM" | openssl rsa -pubout 2>/dev/null)
  KEY_ID="key-$(date +%Y%m%d)-$(openssl rand -hex 4)"

  # 將 PEM 轉 base64 儲存（避免換行問題）
  local PRIVATE_KEY_B64 PUBLIC_KEY_B64
  PRIVATE_KEY_B64=$(echo "$PRIVATE_KEY_PEM" | base64 | tr -d '\n')
  PUBLIC_KEY_B64=$(echo "$PUBLIC_KEY_PEM"  | base64 | tr -d '\n')

  # 同時計算 JWK 格式的公鑰參數（n, e）
  local KEY_N KEY_E
  KEY_N=$(echo "$PRIVATE_KEY_PEM" | openssl rsa -noout -text 2>/dev/null | \
    grep -A 20 "modulus:" | grep -v "modulus:" | tr -d ' \n:' | xxd -r -p | base64 | \
    tr '+/' '-_' | tr -d '=' 2>/dev/null || echo "")
  KEY_E="AQAB"  # 65537 in base64url

  vault kv put secret/jwt \
    private_key_pem="$PRIVATE_KEY_B64" \
    public_key_pem="$PUBLIC_KEY_B64" \
    algorithm="RS256" \
    key_id="$KEY_ID" \
    key_size="2048" \
    created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    rotation_period_days="90"

  ok "JWT RS256 Key Pair 已儲存至 secret/jwt (kid: $KEY_ID)"

  # 同時儲存公鑰到獨立路徑（供 Gateway 快速取用）
  vault kv put secret/jwt/public \
    public_key_pem="$PUBLIC_KEY_B64" \
    key_id="$KEY_ID" \
    algorithm="RS256"
  ok "Public Key 已儲存至 secret/jwt/public（供 Gateway JWKS 端點使用）"
}

# ─── Database Credentials ─────────────────────────────────────
setup_db_creds() {
  log "儲存 Database Credentials..."
  vault kv put secret/database/postgres \
    host="${POSTGRES_HOST:-postgres}" \
    port="${POSTGRES_PORT:-5432}" \
    database="${POSTGRES_DB:-apim}" \
    username="${POSTGRES_USER:-apim_user}" \
    password="${POSTGRES_PASSWORD:-apim_pass_dev}" \
    ssl_mode="disable"
  ok "PostgreSQL credentials → secret/database/postgres"

  vault kv put secret/database/redis \
    host="${REDIS_HOST:-redis-master-1}" \
    port="${REDIS_PORT:-6379}" \
    password="${REDIS_PASSWORD:-redis_pass_dev}"
  ok "Redis credentials → secret/database/redis"

  vault kv put secret/database/mongodb \
    host="${MONGO_HOST:-mongodb}" \
    port="${MONGO_PORT:-27017}" \
    database="${MONGO_DB:-apim_analytics}" \
    username="${MONGO_USER:-apim_user}" \
    password="${MONGO_PASSWORD:-mongo_pass_dev}"
  ok "MongoDB credentials → secret/database/mongodb"
}

# ─── Service Secrets ──────────────────────────────────────────
setup_service_secrets() {
  log "儲存 Service Secrets..."

  # Auth Service
  vault kv put secret/services/auth \
    jwt_issuer="${JWT_ISSUER:-https://auth.xcloudapim.local}" \
    jwt_access_ttl="${JWT_ACCESS_TOKEN_TTL:-3600}" \
    jwt_refresh_ttl="${JWT_REFRESH_TOKEN_TTL:-86400}" \
    auth_code_ttl="600"
  ok "Auth Service secrets → secret/services/auth"

  # Gateway
  vault kv put secret/services/gateway \
    hmac_secret="$(openssl rand -hex 32)" \
    admin_api_key="$(openssl rand -hex 32)"
  ok "Gateway secrets → secret/services/gateway"

  # Notification
  vault kv put secret/services/notification \
    smtp_pass="${SMTP_PASS:-}" \
    webhook_signing_secret="$(openssl rand -hex 32)"
  ok "Notification secrets → secret/services/notification"
}

# ─── Transit Secrets Engine（欄位加密） ─────────────────────
setup_transit() {
  log "設定 Transit Secrets Engine（欄位加密）..."
  vault secrets enable transit 2>/dev/null \
    && ok "Transit Engine 已啟用" \
    || warn "Transit Engine 已存在，跳過"

  # AES-256-GCM 加密 Key（用於 API Response 敏感欄位）
  vault write -f transit/keys/field-encryption \
    type=aes256-gcm96 2>/dev/null \
    && ok "Transit Key: field-encryption (AES-256-GCM)" \
    || warn "Transit Key 已存在，跳過"

  # HMAC Key（用於 API Key 雜湊驗證）
  vault write -f transit/keys/api-key-hmac \
    type=hmac 2>/dev/null \
    && ok "Transit Key: api-key-hmac" \
    || warn "Transit Key 已存在，跳過"
}

# ─── Policy 設定（細粒度存取控制） ───────────────────────────
setup_policies() {
  log "建立 Vault Policies..."

  # Auth Service Policy
  vault policy write auth-service - << 'POLICY'
path "secret/data/jwt" {
  capabilities = ["read"]
}
path "secret/data/jwt/public" {
  capabilities = ["read", "update"]
}
path "secret/data/database/postgres" {
  capabilities = ["read"]
}
path "secret/data/database/redis" {
  capabilities = ["read"]
}
path "secret/data/services/auth" {
  capabilities = ["read"]
}
path "transit/sign/api-key-hmac" {
  capabilities = ["update"]
}
POLICY
  ok "Policy: auth-service"

  # Gateway Policy
  vault policy write gateway-service - << 'POLICY'
path "secret/data/jwt/public" {
  capabilities = ["read"]
}
path "secret/data/database/redis" {
  capabilities = ["read"]
}
path "secret/data/services/gateway" {
  capabilities = ["read"]
}
path "transit/decrypt/field-encryption" {
  capabilities = ["update"]
}
POLICY
  ok "Policy: gateway-service"

  # Policy Engine Policy
  vault policy write policy-engine - << 'POLICY'
path "secret/data/database/postgres" {
  capabilities = ["read"]
}
path "secret/data/database/redis" {
  capabilities = ["read"]
}
path "transit/encrypt/field-encryption" {
  capabilities = ["update"]
}
path "transit/decrypt/field-encryption" {
  capabilities = ["update"]
}
POLICY
  ok "Policy: policy-engine"
}

# ─── AppRole Auth（讓服務取得 Token） ────────────────────────
setup_approle() {
  log "設定 AppRole Auth Method..."
  vault auth enable approle 2>/dev/null \
    && ok "AppRole 已啟用" \
    || warn "AppRole 已存在，跳過"

  for svc in auth-service gateway-service policy-engine; do
    vault write auth/approle/role/$svc \
      policies="$svc" \
      token_ttl=1h \
      token_max_ttl=4h \
      secret_id_ttl=0 2>/dev/null && ok "AppRole Role: $svc"
  done
}

# ─── 輸出摘要 ─────────────────────────────────────────────────
print_summary() {
  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════════${RESET}"
  echo -e "${GREEN}  ✅ Vault 初始化完成！${RESET}"
  echo -e "${GREEN}═══════════════════════════════════════════════${RESET}"
  echo ""
  echo "  Vault UI:    $VAULT_ADDR/ui"
  echo "  Root Token:  $VAULT_TOKEN"
  echo ""
  echo "  Secrets："
  vault kv list secret/ 2>/dev/null | sed 's/^/    /' || true
  echo ""
  echo "  PKI CA:      $VAULT_ADDR/v1/pki/ca/pem"
  echo "  JWT JWKS:    (由 Auth Service 在 /oauth2/jwks 提供)"
  echo ""
}

# ─── Main ────────────────────────────────────────────────────
main() {
  echo ""
  echo -e "${CYAN}════════════════════════════════════════════════${RESET}"
  echo -e "${CYAN}  xCloudAPIM Vault 初始化 — $(date '+%Y-%m-%d %H:%M:%S')${RESET}"
  echo -e "${CYAN}════════════════════════════════════════════════${RESET}"
  echo ""

  wait_vault
  setup_kv
  setup_pki
  setup_jwt_keys
  setup_db_creds
  setup_service_secrets
  setup_transit
  setup_policies
  setup_approle
  print_summary
}

main "$@"
