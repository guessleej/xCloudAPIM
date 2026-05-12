# ═══════════════════════════════════════════════════════════════
#  Vault Production Configuration（開發環境 file backend）
#  生產環境請改用 integrated raft storage 或 Consul backend
# ═══════════════════════════════════════════════════════════════

ui = true

storage "file" {
  path = "/vault/data"
}

listener "tcp" {
  address       = "0.0.0.0:8200"
  tls_disable   = true   # 開發用；生產環境設 tls_cert_file / tls_key_file
}

api_addr     = "http://vault:8200"
cluster_addr = "http://vault:8201"

# 防止 core dump 洩漏敏感記憶體
disable_mlock = false

log_level  = "info"
log_format = "json"

# ─── 生產環境補充（取消注釋並填入路徑）──────────────────────
# listener "tcp" {
#   address         = "0.0.0.0:8200"
#   tls_cert_file   = "/vault/tls/vault.crt"
#   tls_key_file    = "/vault/tls/vault.key"
#   tls_min_version = "tls12"
# }
