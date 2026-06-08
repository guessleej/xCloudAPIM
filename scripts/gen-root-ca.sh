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

# datastore → 輸出目錄 / SAN / 檔名 / 擁有者 uid / 合併 PEM / 是否複製 ca.crt
PEM=""; CACP=""
case "$DS" in
  postgres)      OUT="infra/postgres/certs";      SAN="DNS:postgres,DNS:localhost,IP:127.0.0.1";      CRT="server.crt"; KEY="server.key"; UID_OWN="70" ;;
  mongodb)       OUT="infra/mongodb/certs";       SAN="DNS:mongodb,DNS:localhost,IP:127.0.0.1";       CRT="mongo.crt";  KEY="mongo.key";  UID_OWN="999"; PEM="mongo.pem"; CACP="1" ;;
  vault)         OUT="infra/vault/tls";           SAN="DNS:vault,DNS:localhost,IP:127.0.0.1";         CRT="vault.crt";  KEY="vault.key";  UID_OWN="0" ;;
  elasticsearch) OUT="infra/elasticsearch/certs"; SAN="DNS:elasticsearch,DNS:localhost,IP:127.0.0.1"; CRT="es.crt";     KEY="es.key";     UID_OWN="1000"; CACP="1" ;;
  redis)         OUT="infra/redis/certs"; SAN="DNS:redis-master-1,DNS:redis-master-2,DNS:redis-master-3,DNS:redis-replica-1,DNS:redis-replica-2,DNS:redis-replica-3,DNS:localhost,IP:127.0.0.1"; CRT="redis.crt"; KEY="redis.key"; UID_OWN="999"; CACP="1" ;;
  kafka)         OUT="infra/kafka/secrets" ;; # 特殊路徑（JKS，見下）
  *) echo "❌ 尚未支援的 datastore: $DS（目前：postgres / mongodb / vault / elasticsearch / kafka）"; exit 1 ;;
esac
mkdir -p "$OUT"

# ─── kafka：Java JKS keystore/truststore（以 Root CA 簽發，需 keytool）─────
if [ "$DS" = "kafka" ]; then
  [ -f "$PKI/rootCA.crt" ] || { echo "❌ 請先以其他 datastore 產生 Root CA（infra/pki/rootCA.{crt,key}）"; exit 1; }
  KPW="${KAFKA_SSL_PASSWORD:-$(grep -E '^KAFKA_SSL_PASSWORD=' .env 2>/dev/null | cut -d= -f2)}"
  [ -n "$KPW" ] || { echo "❌ 需 KAFKA_SSL_PASSWORD（.env 或環境變數）"; exit 1; }
  docker run --rm --user root -e KPW="$KPW" -v "$PWD/$PKI:/pki" -v "$PWD/$OUT:/w" confluentinc/cp-kafka:7.6.0 bash -c '
    set -e; cd /w
    openssl req -nodes -newkey rsa:2048 -keyout kafka.key -out kafka.csr -subj /CN=kafka 2>/dev/null
    printf "subjectAltName=DNS:kafka,DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n" > k.ext
    openssl x509 -req -in kafka.csr -CA /pki/rootCA.crt -CAkey /pki/rootCA.key -CAcreateserial \
      -days 825 -out kafka.crt -extfile k.ext 2>/dev/null
    # keystore：含 leaf + Root CA 鏈（broker 送出完整鏈供 client 驗證）
    openssl pkcs12 -export -in kafka.crt -inkey kafka.key -certfile /pki/rootCA.crt \
      -name kafka -out kafka.p12 -password pass:$KPW 2>/dev/null
    rm -f kafka.keystore.jks
    keytool -importkeystore -srckeystore kafka.p12 -srcstoretype PKCS12 -srcstorepass $KPW \
      -destkeystore kafka.keystore.jks -deststorepass $KPW -noprompt 2>/dev/null
    # truststore：信任 Root CA
    rm -f kafka.truststore.jks
    keytool -import -alias rootca -file /pki/rootCA.crt -keystore kafka.truststore.jks -storepass $KPW -noprompt 2>/dev/null
    rm -f kafka.p12 kafka.csr k.ext
    chmod 644 kafka.keystore.jks kafka.truststore.jks
    ls -l kafka.keystore.jks kafka.truststore.jks'
  echo "✅ kafka JKS（Root CA 簽發）已重建於 $OUT"
  exit 0
fi

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
# 合併 PEM（mongodb tlsCertificateKeyFile）
if [ -n '$PEM' ]; then
  cat /out/$CRT /out/$KEY > /out/$PEM
  chmod 600 /out/$PEM; chown $UID_OWN:$UID_OWN /out/$PEM
fi
# 複製 Root CA 作 ca.crt（mongodb tlsCAFile / elasticsearch+kibana CA）
if [ -n '$CACP' ]; then
  cp rootCA.crt /out/ca.crt
  chmod 644 /out/ca.crt; chown $UID_OWN:$UID_OWN /out/ca.crt
fi
ls -l rootCA.crt /out/$CRT /out/$KEY
"
echo "✅ Root CA + $DS 憑證（由 Root CA 簽發）已產生"
echo "   client 以 sslrootcert/RootCAs=$PKI/rootCA.crt 驗證；逐 datastore 翻 verify-full。"
