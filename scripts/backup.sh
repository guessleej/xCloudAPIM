#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  backup.sh — xCloudAPIM 資料備份（在部署主機執行）
#  備份：PostgreSQL（含不可變 audit_log）、MongoDB、Vault 資料、Redis（best-effort）
#  輸出：./backups/<YYYYmmdd-HHMMSS>/，並保留最近 N 份
#  用法：bash scripts/backup.sh
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "❌ 找不到 .env"; exit 1; }
get() { grep -E "^$1=" .env | head -1 | cut -d= -f2- ; }

TS="$(date +%Y%m%d-%H%M%S)"
OUT="backups/$TS"
RETAIN="${BACKUP_RETAIN:-7}"
mkdir -p "$OUT"
echo "▶ 備份輸出：$OUT"

PG_USER="$(get POSTGRES_USER)"; PG_USER="${PG_USER:-apim_user}"
PG_DB="$(get POSTGRES_DB)";     PG_DB="${PG_DB:-apim}"
PG_PW="$(get POSTGRES_PASSWORD)"
MONGO_USER="$(get MONGO_USER)"; MONGO_USER="${MONGO_USER:-apim_user}"
MONGO_PW="$(get MONGO_PASSWORD)"
REDIS_PW="$(get REDIS_PASSWORD)"

# ── 1) PostgreSQL（本機 socket，免 TLS）──────────────────────
echo "  • PostgreSQL pg_dump…"
docker exec -e PGPASSWORD="$PG_PW" apim-postgres \
  pg_dump -U "$PG_USER" -d "$PG_DB" --no-owner | gzip > "$OUT/postgres-$PG_DB.sql.gz"
echo "  • 不可變 audit_log 單獨匯出…"
docker exec -e PGPASSWORD="$PG_PW" apim-postgres \
  pg_dump -U "$PG_USER" -d "$PG_DB" -t audit_log --data-only | gzip > "$OUT/audit_log.sql.gz" || echo "    (audit_log 尚不存在，略過)"

# ── 2) MongoDB（本機，allowTLS → plain localhost）────────────
echo "  • MongoDB mongodump…"
docker exec apim-mongodb sh -c \
  "mongodump --username '$MONGO_USER' --password '$MONGO_PW' --authenticationDatabase admin --archive --gzip" \
  > "$OUT/mongodb.archive.gz" 2>/dev/null || echo "    (mongodump 失敗，請檢查認證)"

# ── 3) Vault（file storage → 備份資料卷 + 提醒 unseal keys）──
echo "  • Vault 資料卷快照…"
docker run --rm -v xcloudapim_vault-data:/v -v "$PWD/$OUT":/b alpine \
  tar czf /b/vault-data.tgz -C /v . 2>/dev/null || echo "    (vault-data 卷快照失敗)"
echo "    ⚠️  Vault unseal keys（.init_keys）請另行離線加密保管，勿與此備份同處存放。"

# ── 4) Redis（best-effort BGSAVE + 複製 rdb）─────────────────
echo "  • Redis BGSAVE…"
docker exec apim-redis-master-1 sh -c \
  "redis-cli -a '$REDIS_PW' --tls --cert /certs/redis.crt --key /certs/redis.key --cacert /certs/ca.crt BGSAVE" \
  >/dev/null 2>&1 && echo "    (已觸發 BGSAVE，RDB 隨卷保存)" || echo "    (Redis 為快取，略過/best-effort)"

# ── 5) 校驗碼 + 保留輪替 ─────────────────────────────────────
( cd "$OUT" && sha256sum * > SHA256SUMS 2>/dev/null || true )
echo "  • 產生 SHA256SUMS"
ls -1dt backups/*/ 2>/dev/null | tail -n +"$((RETAIN+1))" | xargs -r rm -rf
echo "  • 保留最近 $RETAIN 份"

echo "✅ 備份完成：$OUT"
du -sh "$OUT"
