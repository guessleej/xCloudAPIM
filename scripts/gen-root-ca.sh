#!/usr/bin/env sh
# ═══════════════════════════════════════════════════════════════
#  gen-root-ca.sh — 統一內部 Root CA + 逐 datastore 簽發伺服器憑證（P3 Phase 5）
#  Root CA：infra/pki/{rootCA.crt, rootCA.key}（key 為機密，gitignored；保留供逐步簽發）
#  用法：sh scripts/gen-root-ca.sh [datastore]
#    datastore 預設 postgres；可擴充 redis/mongodb/kafka/elasticsearch（逐步翻 verify-full）
#  各 client 以 sslrootcert / RootCAs=rootCA.crt 做 verify-full 鏈驗證。
# ═══════════════════════════════════════════════════════════════
set -eu
DS="${1:-postgres}"
PKI="infra/pki"
mkdir -p "$PKI"

# datastore → 輸出目錄 / SAN / 檔名 / 擁有者 uid
case "$DS" in
  postgres) OUT="infra/postgres/certs"; SAN="DNS:postgres,DNS:localhost,IP:127.0.0.1"; CRT="server.crt"; KEY="server.key"; UID_OWN="70" ;;
  *) echo "❌ 尚未支援的 datastore: $DS（目前：postgres）"; exit 1 ;;
esac
mkdir -p "$OUT"

docker run --rm --entrypoint sh \
  -v "$PWD/$PKI:/pki" -v "$PWD/$OUT:/out" alpine/openssl -c "
set -e
cd /pki
if [ ! -f rootCA.crt ]; then
  openssl req -x509 -nodes -newkey rsa:4096 -days 3650 \
    -keyout rootCA.key -out rootCA.crt -subj '/CN=xCloudAPIM-Root-CA' 2>/dev/null
  echo 'Root CA created'
else
  echo 'Root CA exists, reusing'
fi
openssl req -nodes -newkey rsa:2048 -keyout /out/$KEY -out /tmp/s.csr -subj '/CN=$DS' 2>/dev/null
printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\n' '$SAN' > /tmp/s.ext
openssl x509 -req -in /tmp/s.csr -CA rootCA.crt -CAkey rootCA.key -CAcreateserial \
  -days 825 -out /out/$CRT -extfile /tmp/s.ext 2>/dev/null
chmod 644 /out/$CRT rootCA.crt
chmod 600 /out/$KEY rootCA.key
chown $UID_OWN:$UID_OWN /out/$CRT /out/$KEY
ls -l rootCA.crt /out/$CRT /out/$KEY
"
echo "✅ Root CA + $DS 憑證（由 Root CA 簽發）已產生"
echo "   client 以 sslrootcert/RootCAs=$PKI/rootCA.crt 驗證；逐 datastore 翻 verify-full。"
