#!/usr/bin/env sh
# ═══════════════════════════════════════════════════════════════
#  gen-mtls-certs.sh — 產生服務間 mTLS 用的內部 CA 與服務憑證（P3-3）
#  輸出：infra/mtls/certs/{ca.crt, service.crt, service.key}
#  - ca.crt     ：內部 CA（各服務以此驗證對方）
#  - service.crt：所有服務共用的憑證（同時作 server 與 client 憑證）
#    SAN 涵蓋所有內部服務名，故可作為 server 憑證；亦含 clientAuth 用途。
#  以容器（alpine/openssl）執行，避免依賴主機 openssl。
# ═══════════════════════════════════════════════════════════════
set -eu
CERT_DIR="infra/mtls/certs"
mkdir -p "$CERT_DIR"

SANS="DNS:localhost,DNS:auth-service,DNS:registry-service,DNS:subscription-service,DNS:policy-engine,DNS:gateway,DNS:bff,DNS:portal,DNS:studio,DNS:nginx,DNS:analytics-service,DNS:notification-service,DNS:audit-sink,IP:127.0.0.1"

docker run --rm --entrypoint sh -v "$PWD/$CERT_DIR:/c" alpine/openssl -c "
set -e
cd /c
# 1) 內部 CA
openssl req -x509 -nodes -days 1825 -newkey rsa:2048 \
  -keyout ca.key -out ca.crt -subj '/CN=xCloudAPIM-Internal-CA' 2>/dev/null
# 2) 服務私鑰 + CSR
openssl req -nodes -newkey rsa:2048 -keyout service.key -out service.csr \
  -subj '/CN=xcloudapim-service' 2>/dev/null
# 3) 以 CA 簽發服務憑證（serverAuth + clientAuth + SAN）
printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth,clientAuth\n' '$SANS' > ext.cnf
openssl x509 -req -in service.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 825 -out service.crt -extfile ext.cnf 2>/dev/null
rm -f service.csr ext.cnf ca.srl ca.key   # 簽發後即丟棄 CA 私鑰（離線保管更佳）
chmod 644 ca.crt service.crt service.key
ls -l ca.crt service.crt service.key
"
echo '✅ mTLS 憑證已產生於 '"$CERT_DIR"'（ca.crt / service.crt / service.key）'
echo '⚠️  CA 私鑰已於簽發後刪除；如需再簽發請重新產生整組或離線保管 ca.key'
