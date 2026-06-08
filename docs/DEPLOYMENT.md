# xCloudAPIM — 部署流程（docker-compose）

本文件說明如何以 **docker-compose** 在一台 Linux 主機上**首次全新部署** xCloudAPIM，
以及日常維運指令與疑難排解。已於 `192.168.11.50` 實際驗證。

> 對應安全文件：[`docs/security/`](./security/)。生產強化路線圖見 [`03-secure-architecture.md`](./security/03-secure-architecture.md) §8。

---

## 1. 前置需求

| 項目 | 需求 |
|------|------|
| OS | Linux（x86_64） |
| Docker Engine | ≥ 24 |
| Docker Compose | v2.24+（需支援 `!override` YAML tag） |
| 資源 | ≥ 8 GB RAM、≥ 10 GB 磁碟（完整堆疊約 38 容器） |
| 對外埠 | 見 §6；首次部署前先確認無衝突 |

---

## 2. 取得程式碼

repo 為公開，可直接 clone：

```bash
cd ~
git clone https://github.com/guessleej/xCloudAPIM.git
cd xCloudAPIM
```

> 若 repo 為私有，遠端需先設定 GitHub 認證（PAT 或 deploy key），或改用 rsync 同步
> （**勿**將本機含真實密鑰的 `.env` 一併傳送）。

---

## 3. 產生 `.env` 強密鑰

複製範本並以 `openssl` 產生隨機強密鑰（**不要**沿用 `.env.example` 的佔位值）：

```bash
cp .env.example .env
gen() { openssl rand -hex "$1"; }
set_kv() { sed -i "s|^${1}=.*|${1}=${2}|" .env; }

# 密碼類（48 hex）
for k in POSTGRES_PASSWORD REDIS_PASSWORD MONGO_PASSWORD ELASTIC_PASSWORD \
         KIBANA_PASSWORD GF_SECURITY_ADMIN_PASSWORD PGADMIN_DEFAULT_PASSWORD \
         INFLUXDB_K6_PASSWORD INFLUXDB_K6_ADMIN_TOKEN MGMT_ADMIN_PASSWORD; do
  set_kv "$k" "$(gen 24)"
done
# 秘密/金鑰類（64 hex，需 ≥32 字元）
for k in SESSION_SECRET JWT_SECRET INTERNAL_SERVICE_SECRET KIBANA_ENCRYPTION_KEY; do
  set_kv "$k" "$(gen 32)"
done
# VAULT_TOKEN 先留佔位，待 §5 Vault 初始化後再填入真正的 root token
set_kv VAULT_TOKEN "PENDING_VAULT_INIT"
set_kv VAULT_DEV_ROOT_TOKEN_ID "PENDING_VAULT_INIT"

chmod 600 .env
```

---

## 4. 處理埠衝突（docker-compose.override.yml）

若主機既有服務佔用了本專案要綁定的埠，**不要改主檔**，改用 override（compose 會自動合併）。
本專案曾遇到的衝突：`3001`(portal)、`3002`(grafana)、`8080`(kafka-ui)。

```bash
cat > docker-compose.override.yml << 'YAML'
# 環境專用埠重映射（不影響 git 追蹤的主檔）
services:
  portal:
    ports: !override
      - "13001:3001"
  grafana:
    ports: !override
      - "13002:3000"
  kafka-ui:
    ports: !override
      - "127.0.0.1:18087:8080"
YAML

# 檢查還有哪些埠被占用（依實際情況調整上面的 override）
for p in 15433 16379 27017 9200 9092 19000 19443 18090 14000 5173 18091 18082 18083 18084; do
  ss -ltn 2>/dev/null | grep -q ":$p " && echo "OCCUPIED: $p"
done

docker compose config -q && echo "✅ compose 設定有效"
```

---

## 5. 產生 TLS 憑證

憑證目錄被 `.gitignore` 忽略，首次部署需自行產生。
**注意**：Docker 首次掛載會把目錄建為 `root` 擁有，故用 root 容器產生。

### 5.1 nginx 反向代理憑證

```bash
docker run --rm -v "$PWD/infra/nginx/certs:/certs" alpine/openssl \
  req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /certs/apim.key -out /certs/apim.crt \
  -subj "/C=TW/ST=Taiwan/L=Taipei/O=xCloudAPIM/CN=*.apim.local" \
  -addext "subjectAltName=DNS:localhost,DNS:*.apim.local,DNS:apim.local"
```

### 5.2 Elasticsearch HTTP TLS 憑證（P2-A）

```bash
mkdir -p infra/elasticsearch/certs
docker run --rm -v "$PWD/infra/elasticsearch/certs:/certs" alpine/openssl \
  req -x509 -nodes -days 825 -newkey rsa:2048 \
  -keyout /certs/es.key -out /certs/es.crt \
  -subj "/CN=elasticsearch" \
  -addext "subjectAltName=DNS:elasticsearch,DNS:localhost,IP:127.0.0.1,IP:172.28.0.60"
# ES 以 uid 1000 執行，金鑰需可讀（alpine/openssl 的 entrypoint 是 openssl，chmod 要另開 alpine）
docker run --rm -v "$PWD/infra/elasticsearch/certs:/certs" alpine sh -c "chmod 644 /certs/es.key /certs/es.crt"
```

### 5.3 Postgres TLS 憑證（P2-A）

```bash
mkdir -p infra/postgres/certs
docker run --rm -v "$PWD/infra/postgres/certs:/certs" alpine/openssl \
  req -x509 -nodes -days 825 -newkey rsa:2048 \
  -keyout /certs/server.key -out /certs/server.crt \
  -subj "/CN=postgres" \
  -addext "subjectAltName=DNS:postgres,DNS:localhost,IP:127.0.0.1,IP:172.28.0.10"
# postgres 拒絕啟動若 key 權限過寬：須 chmod 600 且擁有者為 postgres 使用者(uid 70 alpine)
docker run --rm -v "$PWD/infra/postgres/certs:/certs" alpine sh -c \
  "chown 70:70 /certs/server.key /certs/server.crt && chmod 600 /certs/server.key && chmod 644 /certs/server.crt"
```

### 5.4 MongoDB TLS 憑證（P2-A）

MongoDB 需 cert+key **合併 PEM**；MongoDB 7 啟用 TLS 須同時指定信任鏈
（`--tlsCAFile`，SERVER-72839），自簽憑證以自身為 CA。

```bash
mkdir -p infra/mongodb/certs
docker run --rm -v "$PWD/infra/mongodb/certs:/certs" alpine/openssl \
  req -x509 -nodes -days 825 -newkey rsa:2048 \
  -keyout /certs/mongo.key -out /certs/mongo.crt \
  -subj "/CN=mongodb" \
  -addext "subjectAltName=DNS:mongodb,DNS:localhost,IP:127.0.0.1,IP:172.28.0.50"
# 合併 PEM，並設為 mongodb 使用者(uid 999) 可讀
docker run --rm -v "$PWD/infra/mongodb/certs:/certs" alpine sh -c \
  "cat /certs/mongo.key /certs/mongo.crt > /certs/mongo.pem && chown 999:999 /certs/mongo.pem && chmod 600 /certs/mongo.pem"
```

> mongo-express（127.0.0.1 管理 UI）內部會注入衝突的 ssl/tls 選項，故維持明文
> 連線（mongo 為 allowTLS）；app 流量（analytics/notification）已加密。

### 5.5 Redis Cluster TLS 憑證（P2-A）

6 個節點共用一張憑證，SAN 須涵蓋所有節點 DNS + IP（cluster bus 互信）。

```bash
mkdir -p infra/redis/certs
docker run --rm -v "$PWD/infra/redis/certs:/certs" alpine/openssl \
  req -x509 -nodes -days 825 -newkey rsa:2048 \
  -keyout /certs/redis.key -out /certs/redis.crt -subj "/CN=redis-cluster" \
  -addext "subjectAltName=DNS:redis-master-1,DNS:redis-master-2,DNS:redis-master-3,DNS:redis-replica-1,DNS:redis-replica-2,DNS:redis-replica-3,DNS:localhost,IP:127.0.0.1,IP:172.28.0.20,IP:172.28.0.21,IP:172.28.0.22,IP:172.28.0.23,IP:172.28.0.24,IP:172.28.0.25"
docker run --rm -v "$PWD/infra/redis/certs:/certs" alpine sh -c "chmod 644 /certs/redis.key /certs/redis.crt"
```

> **既有 cluster 切 TLS 需重組**：cluster bus 由非-TLS 改 TLS 無法平滑切換，須清掉
> master 資料卷（含 nodes.conf）重新組 cluster——**快取清空、session 失效**：
> ```bash
> docker compose stop redis-master-1 redis-master-2 redis-master-3 \
>   redis-replica-1 redis-replica-2 redis-replica-3 redis-cluster-init
> docker compose rm -f redis-master-1 redis-master-2 redis-master-3 \
>   redis-replica-1 redis-replica-2 redis-replica-3 redis-cluster-init
> docker volume rm xcloudapim_redis-master1-data xcloudapim_redis-master2-data xcloudapim_redis-master3-data
> docker compose up -d redis-master-1 redis-master-2 redis-master-3 \
>   redis-replica-1 redis-replica-2 redis-replica-3
> docker compose run --rm redis-cluster-init        # TLS 組 cluster
> ```
> client（gateway/analytics/auth/policy-engine/subscription）由 `REDIS_TLS=true` 啟用 TLS，
> 需重建映像；redis-exporter 用 `rediss://` + skip verify。全新部署一次帶 TLS 起即可，無此重組步驟。

### 5.6 Kafka SASL_SSL 憑證（JKS，P2-A）

Kafka（Java）需 **JKS** keystore/truststore（非 PEM）。需 `.env` 先有
`KAFKA_SASL_PASSWORD`（SASL/PLAIN 密碼）與 `KAFKA_SSL_PASSWORD`（keystore 密碼）：

```bash
grep -q '^KAFKA_SASL_PASSWORD=' .env || echo "KAFKA_SASL_PASSWORD=$(openssl rand -hex 24)" >> .env
grep -q '^KAFKA_SSL_PASSWORD='  .env || echo "KAFKA_SSL_PASSWORD=$(openssl rand -hex 16)"  >> .env
mkdir -p infra/kafka/secrets
KPW=$(grep '^KAFKA_SSL_PASSWORD=' .env | cut -d= -f2)
docker run --rm -e KPW="$KPW" -v "$PWD/infra/kafka/secrets:/w" confluentinc/cp-kafka:7.6.0 bash -c '
  set -e; cd /w
  openssl req -x509 -nodes -days 825 -newkey rsa:2048 -keyout kafka.key -out kafka.crt \
    -subj /CN=kafka -addext subjectAltName=DNS:kafka,DNS:localhost,IP:127.0.0.1,IP:172.28.0.31 2>/dev/null
  openssl pkcs12 -export -in kafka.crt -inkey kafka.key -name kafka -out kafka.p12 -password pass:$KPW 2>/dev/null
  keytool -importkeystore -srckeystore kafka.p12 -srcstoretype PKCS12 -srcstorepass $KPW \
    -destkeystore kafka.keystore.jks -deststorepass $KPW -noprompt 2>/dev/null
  keytool -import -alias kafka-ca -file kafka.crt -keystore kafka.truststore.jks -storepass $KPW -noprompt 2>/dev/null
  rm -f kafka.p12; chmod 644 kafka.keystore.jks kafka.truststore.jks'
```

重點（踩過的坑）：
- broker 用 **dual-listener**：PLAINTEXT://9092（inter-broker、kafka-init 不變）+ EXTERNAL(SASL_SSL)://9093（app client）。
- listener 名稱**避免底線**（cp-kafka env→property 把 `_`→`.` 會破壞 `listener.name.*` 鍵），故命名 `EXTERNAL` 而非 `SASL_SSL`。
- SASL 啟用時 image 要求 `KAFKA_OPTS` 非空（dub ensure）→ 給無害佔位值；JAAS 由 `KAFKA_LISTENER_NAME_EXTERNAL_PLAIN_SASL_JAAS_CONFIG` 提供。
- 必須用 `KAFKA_SSL_KEYSTORE_LOCATION`/`_PASSWORD`（FILENAME/CREDENTIALS 檔案模式在此 image 未套用 → `ssl.keystore.location=null` → handshake_failure）。
- client（analytics/notification kafkajs、registry kafka-go）由 `KAFKA_SASL_USERNAME`/`KAFKA_SASL_PASSWORD` 啟用 SASL_SSL，連 `kafka:9093`。

> 生產環境請改用正式 CA 簽發或 mkcert（見 `scripts/gen-certs.sh`）。

---

## 6. 建置與啟動

### 6.1 建置映像

```bash
docker compose build          # 建置 10 個應用映像（首次約數分鐘）
```

### 6.2 Vault 初始化（關鍵：token 流程）

Vault 採 production 模式（file storage），root token 於**執行期**由 `vault-init` 產生，
應用服務需用**相同的** `VAULT_TOKEN` 才能讀密鑰。故順序為：

```bash
# (1) 先起 vault，等 healthy
docker compose up -d vault
until [ "$(docker inspect apim-vault --format '{{.State.Health.Status}}')" = healthy ]; do sleep 3; done

# (2) 執行初始化（init + unseal + 寫入 JWT/DB/internal 密鑰）
docker compose run --rm vault-init

# (3) 取出 root token 寫入 .env
RT=$(docker exec apim-vault cat /vault/data/.init_keys \
     | grep -o '"root_token": *"[^"]*"' | sed 's/.*"root_token": *"//; s/"$//')
sed -i "s|^VAULT_TOKEN=.*|VAULT_TOKEN=${RT}|" .env
sed -i "s|^VAULT_DEV_ROOT_TOKEN_ID=.*|VAULT_DEV_ROOT_TOKEN_ID=${RT}|" .env
echo "✅ VAULT_TOKEN 已寫入"
```

> ⚠️ `/vault/data/.init_keys` 含 root token 與 5 把 unseal key，**請立即安全備份**。
> Vault 重啟後會 sealed，需重新 unseal（見 §8）。

### 6.3 啟動全部服務

```bash
docker compose up -d          # 啟動全部 ~38 容器
```

啟動順序由 `depends_on` + healthcheck 自動處理：
infra（postgres/redis/kafka/mongo/es）→ flyway migration → 應用服務 → nginx。

### 6.4 Elasticsearch 內建使用者密碼（kibana_system）

ES 首次啟動只設定 `elastic` 超級使用者密碼；內建的 `kibana_system` 使用者
密碼需另外設定成 `KIBANA_PASSWORD`，否則 kibana 連 ES 會 `security_exception`：

```bash
EP=$(grep '^ELASTIC_PASSWORD=' .env | cut -d= -f2)
KP=$(grep '^KIBANA_PASSWORD=' .env | cut -d= -f2)
docker exec apim-elasticsearch sh -c \
  "curl -sk -u elastic:$EP -X POST https://localhost:9200/_security/user/kibana_system/_password \
   -H 'Content-Type: application/json' -d '{\"password\":\"$KP\"}'"
docker compose restart kibana
```

---

## 7. 驗證

```bash
# 容器狀態（應為大量 Up + 4 個 init Exited）
docker compose ps -a

# Redis cluster
RP=$(grep '^REDIS_PASSWORD=' .env | cut -d= -f2)
docker exec apim-redis-m1 redis-cli -a "$RP" cluster info | grep cluster_state
# 預期：cluster_state:ok

# Gateway
docker exec apim-gateway sh -c 'wget -qO- http://localhost:8080/healthz'
# 預期：{"status":"ok",...}

# nginx HTTPS
curl -sk -o /dev/null -w '%{http_code}\n' \
  --resolve api.apim.local:19443:127.0.0.1 https://api.apim.local:19443/healthz
# 預期：200
```

### 對外存取埠

| 服務 | 埠 | 備註 |
|------|-----|------|
| nginx | `19000`(HTTP) / `19443`(HTTPS) | 反向代理入口 |
| gateway | `18090` | API 資料平面 |
| bff | `14000` | GraphQL |
| portal | `13001` | 開發者入口（範例重映射） |
| studio | `5173` | 策略編輯器 |
| auth / registry / subscription / policy-engine | `18091` / `18082` / `18084` / `18083` | |
| grafana / kafka-ui | `13002` / `127.0.0.1:18087` | 監控（範例重映射） |

> 實際埠以 `docker-compose.yml` + 你的 `docker-compose.override.yml` 為準。

---

## 8. 日常維運指令

```bash
cd ~/xCloudAPIM
docker compose ps                       # 狀態
docker compose logs -f <service>        # 追 log（如 auth-service）
docker compose restart <service>        # 重啟單一服務
docker compose down                     # 停止全部（保留 volume）
docker compose up -d                    # 啟動全部

# 更新版本
git pull --ff-only origin main
docker compose build
docker compose up -d

# Vault 重啟後重新 unseal（data 持久，但會 sealed）
for i in 0 1 2; do
  KEY=$(docker exec apim-vault sh -c "grep -o '\"unseal_keys_b64\":\[[^]]*\]' /vault/data/.init_keys" \
        | grep -o '\"[^\"]*\"' | sed -n "$((i+1))p" | tr -d '\"')
  docker exec -e VAULT_ADDR=http://127.0.0.1:8200 apim-vault vault operator unseal "$KEY"
done
```

---

## 8.5 網路多網段分區（P2-B）部署注意

4 網段（edge/app/svc/data）皆可由 `.env` 設定（見 `.env.example` P2-B 區段）。
**既有單網段切多網段需 down/up 重建**，注意：

- `docker compose down` **不會移除**已不在 compose 中的舊網段（`xcloudapim_apim-net`）；
  其 /16 會與新 /24 子網重疊 → `up` 報 `Pool overlaps`。需手動
  `docker network rm xcloudapim_apim-net` 後再 `up`。
- `svc-net`/`data-net` 為 `internal: true`（無對外 egress）。**需要 runtime 下載的
  init job（vault-init 裝 openssl）必須多接 `app-net` 取得 egress**，否則 apk 失敗。
- redis 節點 IP 改到 `DATA_SUBNET`（預設 172.28.40.21-26），需清 master 資料卷重組 cluster。
- 重建後 Vault 會 sealed；若 `.init_keys` 完好可手動 unseal，否則清 `vault-data` 重新 init
  （JWT 金鑰重生 = token 重置）。
- 驗證隔離：`docker exec apim-nginx sh -c "nc -z postgres 5432"` 應**連不到**（資料層已隔離）。

## 8.6 Vault 動態 DB 憑證（P2-B-2）

postgres client（auth/registry/subscription/policy-engine）可改用 Vault **動態簽發**
的臨時帳密（取代靜態 POSTGRES_PASSWORD）：

- vault-prod-init.sh 已自動設定 DB secrets engine + 角色 `apim-dyn`
  （default TTL 24h、max 168h；Vault 以 apim_user/superuser 連 postgres 建臨時角色）。
- 以 `.env` 全域開關啟用：`VAULT_DB_CREDS=true`（預設 false → 沿用靜態，可隨時回滾）。
- 各服務啟動時向 `database/creds/apim-dyn` 取帳密；背景 renew lease，接近 max_ttl
  或 renew 失敗則重新簽發並 swap connector（單一 *sql.DB 物件不變）。
- 驗證：`docker exec apim-postgres psql -U apim_user -d apim -c "SELECT usename,client_addr
  FROM pg_stat_activity WHERE datname='apim' AND client_addr IS NOT NULL;"`
  → 服務應以 `v-root-apim-dyn-…` 動態帳號連線（apim_user 僅剩 Vault 引擎管理連線 + exporter）。
- 限制：跨 max_ttl(168h) 不重啟的零停機輪轉需 connector 已支援；exporter 仍用靜態帳密。
- 手動驗證可簽發：`docker exec -e VAULT_TOKEN=<root> apim-vault vault read database/creds/apim-dyn`。

## 8.7 不可變稽核日誌（P3-1）

- migration **V9** 建立 `audit_log`：觸發器禁止 UPDATE/DELETE/TRUNCATE（append-only），
  每列 `row_hash = sha256(prev_hash|topic|payload)` 形成防竄改 hash chain。
- **audit-sink** 服務消費 `auth.events` / `policy.published` / `subscription.events`
  （Kafka SASL_SSL）→ 交易內 advisory lock 計算 hash chain 後寫入（postgres TLS）。
- 驗證不可變性：`UPDATE/DELETE audit_log` 會被擋（`append-only ... not permitted`）。
- 驗證 hash chain：`SELECT prev_hash FROM audit_log WHERE id=N` 應等於 id=N-1 的 row_hash。
- **事件產生端**：auth-service 已在 login / login_failed / logout / register 發布事件至
  `auth.events`（best-effort、Async、非阻塞）。已端到端驗證：登入嘗試 → audit_log 出現
  對應列（event_type/actor/hash chain）。policy-engine/subscription 的事件產生可比照
  `internal/audit` 套件加入（policy.published / subscription.events）。

## 8.8 自動 JWT 金鑰輪轉（P3-2）

- auth-service 背景 goroutine 依 `JWT_ROTATION_INTERVAL`（預設 168h）自動輪轉 JWT
  簽章金鑰：產生新 RSA 金鑰 → 寫入 Vault `secret/jwt`（KV v2 新版本）→ 清快取。
- 由 `.env` `JWT_AUTO_ROTATE=true` 啟用（預設 false → 不輪轉，可回滾）。
- **零停機**：JWKS（`/oauth2/jwks`）同時公開「當前 + 前一 KV 版本」公鑰（kid 為公鑰
  RFC 7638 指紋），輪轉前簽發、未過期的 token 仍可由 gateway/bff 驗證至到期。
- 驗證：`vault kv metadata get secret/jwt` 的 current_version 隨時間遞增；
  `wget -qO- http://localhost:8081/oauth2/jwks`（auth 容器內）應有 2 個 kid。
- 安全：auth 目前以 root token 寫 Vault；生產建議改 AppRole + 限定 secret/jwt 寫入策略。

## 8.9 服務間 mTLS（P3-3，應用層）

採 **dual-listener + `MTLS_ENABLED` 開關**漸進遷移（避免一次切換全服務造成中斷）。

```bash
sh scripts/gen-mtls-certs.sh          # 產生內部 CA + 共用服務憑證 → infra/mtls/certs
# .env：MTLS_ENABLED=true 啟用（Go 服務於 :9443 起 mTLS listener，plain port 保留）
```

- **已完成（P3-3a）**：auth/registry/subscription/policy-engine 於 `:9443` 提供強制 mTLS
  （`RequireAndVerifyClientCert` + 內部 CA），與既有 plain HTTP port 並存。
- 驗證：帶 client 憑證 `openssl s_client -connect auth-service:9443 -cert service.crt
  -key service.key -CAfile ca.crt` → Verification OK；不帶 → `certificate required` 被拒。
- **待完成（P3-3b）**：client 端（gateway/bff）改連 `:9443` 並帶 client 憑證；
  Node 服務（gateway/bff/portal/studio）mTLS server；nginx upstream mTLS。
  完成後才達端到端強制；在此之前 client 仍走 plain port（mTLS port 已就緒但未被使用）。
- 注意：mTLS 憑證須可被服務使用者(uid 1001 / nginx)讀取；CA 私鑰於簽發後刪除，
  重簽需重產整組（或離線保管 ca.key）。

## 8.10 Vault 硬化（P3）

已上線（vault-prod-init.sh 自動套用）：
- **Audit device**：`/vault/data/vault-audit.log` 記錄所有 Vault 存取（不可否認性）。
- **AppRole**：policy `apim-svc`（最小授權：讀 secret/jwt、internal、database/creds、續租）
  + role `apim`（token_ttl 1h）。`vault read auth/approle/role/apim/role-id` 取 role_id。

**已完成（P3 Phase 3）服務改用 AppRole**：
- 4 Go 服務（auth jwt client + 4 服務 vaultdb）以 `VAULT_ROLE_ID`/`VAULT_SECRET_ID`
  做 AppRole 登入取得 **periodic token**（token_period=1h，背景 renew-self），取代 root
  `VAULT_TOKEN`。policy `apim-svc` 最小授權（讀 jwt/internal/db-creds + 寫 jwt 供輪轉 +
  renew-self）。AppRole 失敗自動 fallback root（漸進/回滾）。已驗證 AppRole login ok +
  JWKS + DB 動態憑證正常。
- root token 僅保留作 vault 管理 / break-glass（建議離線加密保管，不作運行使用）。

**已完成（P3 Phase 4a）Vault TLS**：
- `config.hcl` 啟用 `tls_cert_file`/`tls_key_file`（移除 tls_disable）；`scripts/gen-vault-tls.sh`
  產自簽 vault 憑證。所有 client（vault-init + 4 服務 + healthcheck）改 `https://vault:8200`
  + `VAULT_SKIP_VERIFY=true`。已驗證 https OK / http 被拒、AppRole 登入走 TLS、JWKS/DB 正常。
- **重啟 Vault 會 re-seal**：用 `/vault/data/.init_keys` 的 3 把 key 解封
  （`vault operator unseal -tls-skip-verify <key>`），再重建依賴服務。

**待完成（需 KMS/HSM 基礎設施）Auto-unseal**：
- 真正 auto-unseal 需雲 KMS（AWS/GCP/Azure）或 HSM；transit（第二 Vault）方案的 transit
  vault 本身仍需解封（僅搬移問題）。本內網主機無 KMS，故**保留 Shamir 手動解封**
  （unseal keys 離線加密備份），待具備 KMS 時導入 seal "awskms"/"gcpckms" 區塊。

## 8.11 正式 Root CA + verify-full（P3 Phase 5，逐 datastore 進行中）

統一內部 **Root CA**：`scripts/gen-root-ca.sh <datastore>` 建立 `infra/pki/{rootCA.crt,rootCA.key}`
（key 機密，gitignored；離線保管）並逐 datastore 簽發伺服器憑證（SAN 正確）。

**已完成（postgres）**：
- postgres 重簽為 Root-CA 憑證（`pg_reload_conf` 熱載，免重啟）；驗證 `Verify return code: 0`。
- **4 個 Go 服務（auth/registry/subscription/policy-engine）postgres 連線改 verify-full**
  （`POSTGRES_SSL_MODE=verify-full` + `POSTGRES_SSL_ROOT_CERT=/etc/pki/rootCA.crt`，掛載
  `./infra/pki:/etc/pki`）。已上線驗證鏈驗證成功、動態憑證正常。
- ⚠️ 教訓：改 verify-full 必須**同時 rebuild 服務映像**（vaultdb 需新增 sslrootcert 支援），
  只改 compose env 而用舊映像會 `x509: unknown authority`。

**待完成（同模式逐步進行，每步可回滾）**：
- postgres 其餘 client：flyway（JDBC truststore）、postgres-exporter、audit-sink（node pg）、pgadmin。
- 其他 datastore：`gen-root-ca.sh redis|mongodb|kafka|elasticsearch` 重簽 → 各自 client 由
  `InsecureSkipVerify/tlsInsecure` 改 `RootCAs=rootCA.crt`+`ServerName`（逐一驗證）。
- vault：`VAULT_SKIP_VERIFY=true` → `VAULT_CACERT=rootCA.crt`（重簽 vault 憑證為 Root-CA）。
- 對外端點若有公開網域 → ACME/Let's Encrypt（本部署為內網 IP，暫自簽）。

## 9. 疑難排解（首次部署常見坑）

| 症狀 | 原因 | 解法 |
|------|------|------|
| `kafka-ui` / 某服務 `address already in use` | 主機既有服務佔埠 | 在 `docker-compose.override.yml` 用 `!override` 重映射 |
| nginx `cannot load certificate /etc/nginx/certs/apim.crt` | 憑證未產生（git-ignored） | 執行 §5 產生憑證 |
| nginx 憑證目錄 root-owned、無法寫入 | Docker 掛載時建為 root | 用 root 容器產生（§5），或 `sudo chown` |
| flyway `password authentication failed` | postgres volume 有舊密碼 | 全新 volume；或 `ALTER USER apim_user WITH PASSWORD '<新值>'` |
| `redis-cluster-init` Exited(1) `Node ... is not empty` | cluster 已建立的正常重跑 | **無害**，可忽略 |
| auth-service `JWT keys not ready` 一直重試 | `VAULT_TOKEN` 與 Vault 實際 root token 不符 | 依 §6.2 取出 token 寫回 `.env` 後 `docker compose up -d` |
| 服務啟動後又退出（容器強化相關） | `cap_drop:[ALL]` 移除了必要 capability | 為該服務 `cap_add` 最小必要 caps（如 nginx 需 CHOWN/SETUID/SETGID/NET_BIND_SERVICE） |

### 已知歷史 bug（皆已於程式碼修正，全新部署不再發生）
- **Vault `wait_vault` 在 `set -o pipefail` 下卡死**：未初始化 vault 回傳 exit 2，pipeline 被視為失敗。已改為先 `|| true` 擷取輸出再判斷。
- **Vault 無法寫入自訂 `/vault/data`**：官方 entrypoint 以 su-exec 降權至 vault(uid 100)，只 chown 預設路徑。已改為直接以 root 執行 vault server。

---

## 10. 安全注意事項

- `.env`（權限 600）與 `/vault/data/.init_keys` 含機密，**勿進版控、勿外流**，請安全備份。
- 容器已套用 P1 強化（read-only fs、cap_drop、no-new-privileges）。
- 生產環境另需：資料層 TLS、網路多網段隔離、Vault auto-unseal/動態憑證、服務間 mTLS
  —— 見 [`docs/security/03-secure-architecture.md`](./security/03-secure-architecture.md) §8（P2–P3）。
