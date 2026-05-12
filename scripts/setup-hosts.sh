#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  setup-hosts.sh — 加入 /etc/hosts 條目（需要 sudo）
#  用法：sudo bash scripts/setup-hosts.sh
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

HOSTS_BLOCK="# ── xCloudAPIM local domains ──────────────────
127.0.0.1  api.apim.local
127.0.0.1  bff.apim.local
127.0.0.1  studio.apim.local
127.0.0.1  portal.apim.local
127.0.0.1  grafana.apim.local
127.0.0.1  kibana.apim.local
127.0.0.1  jaeger.apim.local
# ── end xCloudAPIM ─────────────────────────────"

if grep -q "xCloudAPIM local domains" /etc/hosts 2>/dev/null; then
  echo "✅ /etc/hosts 條目已存在，跳過"
  exit 0
fi

echo "$HOSTS_BLOCK" >> /etc/hosts
echo "✅ /etc/hosts 已更新"
