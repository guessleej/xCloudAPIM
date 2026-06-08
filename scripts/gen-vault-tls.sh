#!/usr/bin/env sh
# ═══════════════════════════════════════════════════════════════
#  gen-vault-tls.sh — 產生 Vault listener TLS 自簽憑證（P3 Phase 4）
#  輸出：infra/vault/tls/{vault.crt, vault.key}
#  SAN：vault / localhost / 127.0.0.1（容器內 client + 自身 healthcheck）
#  服務以 VAULT_SKIP_VERIFY=true 連線（加密；驗證鏈見 Phase 5 正式 CA）。
# ═══════════════════════════════════════════════════════════════
set -eu
DIR="infra/vault/tls"
mkdir -p "$DIR"

docker run --rm --entrypoint sh -v "$PWD/$DIR:/c" alpine/openssl -c "
set -e
cd /c
openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -keyout vault.key -out vault.crt \
  -subj '/CN=vault' \
  -addext 'subjectAltName=DNS:vault,DNS:localhost,IP:127.0.0.1' \
  -addext 'keyUsage=digitalSignature,keyEncipherment' \
  -addext 'extendedKeyUsage=serverAuth' 2>/dev/null
chmod 644 vault.crt
chmod 644 vault.key
ls -l vault.crt vault.key
"
echo '✅ Vault TLS 憑證已產生於 '"$DIR"'（vault.crt / vault.key）'
