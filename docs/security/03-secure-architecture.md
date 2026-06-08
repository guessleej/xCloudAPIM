# 03 — 安全架構（Security-by-Design）

> 對應 NIST SSDF **PW.1 / PO.5**、OWASP SAMM **Design**
> 原則：**縱深防禦（Defense in Depth）** + **零信任（Zero Trust）** + **最小權限**

## 1. 架構原則

1. **零信任內網**：服務間呼叫一律驗證（`X-Internal-Token`，目標 mTLS），不因「在內網」而信任。
2. **縱深防禦**：每層（邊界 / 應用 / 服務 / 資料）各自有獨立控制。
3. **最小權限**：容器 non-root、唯讀檔案系統、最小 capabilities；資料庫帳號最小授權。
4. **預設安全（Secure by Default）**：失敗時拒絕（fail-closed），機密不入版控與映像。
5. **可觀測性**：所有安全事件可追蹤（稽核日誌 + 分散式追蹤）。

## 2. 網路分區（Network Segmentation）

目前所有容器位於單一 bridge 網段 `172.28.0.0/16`。**建議重構為多網段**：

| 網段 | 成員 | 對外 |
|------|------|------|
| `edge-net` | nginx | ✅ 443/80 |
| `app-net` | gateway, bff, portal, studio | 僅經 nginx |
| `svc-net` | auth, registry, policy-engine, subscription | ❌ 不對外 |
| `data-net` | postgres, redis, mongodb, kafka, ES, vault | ❌ 僅 svc-net 可達 |

```yaml
# docker-compose 多網段範例（重構目標）
networks:
  edge-net:
  app-net:
  svc-net:
    internal: true     # 無法對外
  data-net:
    internal: true
services:
  nginx:        { networks: [edge-net, app-net] }
  gateway:      { networks: [app-net, svc-net] }
  auth-service: { networks: [svc-net, data-net] }
  postgres:     { networks: [data-net] }
```

> ⚠️ 變更網段會影響 service 解析與既有 IP 綁定，需逐服務驗證。列為 **架構重構第二階段**。

## 3. 傳輸層加密（TLS）矩陣

| 連線 | 現況 | 目標（生產） |
|------|------|------------|
| Internet → nginx | ✅ **TLS 1.2/1.3 + HSTS + 80→443 強制轉址（已上線）** | 生產換正式 CA 憑證 |
| nginx → gateway/bff | ✅ **mTLS（proxy_ssl client 憑證，:9443，已上線）** | 同（生產換正式 CA） |
| gateway/bff → 後端服務 | ✅ **mTLS（內部 CA 雙向驗證，:9443，已上線）** | 同 |
| 服務 → postgres | ✅ **`sslmode=verify-full`（Root CA 鏈驗證，P5 已上線）** | 生產換對外正式 CA |
| 服務 → redis | ✅ **TLS + requirepass（cluster bus 亦 TLS，自簽，P2-A）** | ⚠️ Root-CA verify-full 因 cluster bus 限制未採用（見 §8 P5-redis） |
| 服務 → mongodb | ✅ **TLS + `tlsCAFile`=Root CA 鏈驗證（P5 已上線）** | requireTLS；生產換對外正式 CA |
| 服務 → kafka | ✅ **SASL_SSL + client 帶 Root CA 鏈驗證（P5 已上線）** | 生產換對外正式 CA / SCRAM |
| 服務 → elasticsearch | ✅ **HTTPS + kibana CA 鏈驗證（Root CA，P5 已上線）** | 生產換對外正式 CA |
| 服務 → vault | ✅ **HTTPS + `VAULT_CACERT`=Root CA 鏈驗證（P4 已上線）** | auto-unseal 需 KMS |

憑證產生工具：[`scripts/gen-certs.sh`](../../scripts/gen-certs.sh)。

## 4. 認證與授權架構

### 4.1 對外（使用者 / 開發者）
```
Client ──(OAuth2 Authorization Code + PKCE S256)──▶ auth-service
       ◀──(JWT RS256 access + refresh)─────────────┘
Client ──(Bearer JWT)──▶ nginx ──▶ gateway/bff
                                    │ 驗證 JWT（JWKS，快取 300s）
                                    ▼ scope / role / org 檢查
```
- **PKCE 強制 S256**（拒絕 plain）— `auth/internal/handler/authorize.go`
- **JWT RS256** — 私鑰於 Vault，公鑰經 JWKS 端點公開
- **MFA（TOTP）** — secret 加密儲存

### 4.2 對內（服務間）
- ✅ **mTLS（P3-3 已上線）**：nginx → gateway/bff → 後端（auth/registry/subscription/policy-engine）
  全程於 :9443 雙向 TLS，憑證由內部 CA 簽發、雙向驗證（`MTLS_ENABLED` 開關、dual-listener 可回滾）。
- 應用層身分：`X-Internal-Token = hex(SHA256(INTERNAL_SERVICE_SECRET))`，constant-time 比對（與 mTLS 並用，縱深防禦）。

## 5. 機密管理（Secrets）

| 機密 | 儲存 | 注入方式 | 輪轉 |
|------|------|---------|------|
| JWT 私/公鑰 | Vault `secret/jwt`（base64 PEM） | auth 啟動時讀取 + 快取 | 手動 → 目標自動 |
| DB 帳密 | Vault `secret/database` | 環境變數 / Vault | 目標：Vault 動態憑證 |
| Internal secret | Vault `secret/internal` | 環境變數 | 定期 |
| TLS 憑證 | `infra/nginx/certs`（git-ignored） | volume 掛載 | 到期前更新 |

**規則**：
- 任何機密**不得**進版控（由 secret scanning 強制，見 [07](./07-security-testing.md)）。
- `.env` 已於 `.gitignore`；僅 `.env.example` 入庫（不含真實值）。
- 機密不得寫入 Docker 映像層；以 runtime 注入。

## 6. 容器與執行時強化（CIS Docker Benchmark）

每個服務 Dockerfile / compose 應達成：

```dockerfile
# 目標基線（逐服務套用）
USER 10001:10001                 # non-root
# compose:
#   read_only: true
#   cap_drop: [ALL]
#   security_opt: [no-new-privileges:true]
#   tmpfs: [/tmp]
```

| 控制 | 現況 | 目標 |
|------|------|------|
| Non-root 使用者 | 部分（vault 因 volume 用 root） | 全部 non-root |
| 唯讀根檔案系統 | ❌ | `read_only: true` + tmpfs |
| Drop capabilities | ❌ | `cap_drop: [ALL]` |
| no-new-privileges | ❌ | ✅ |
| 資源限制 | ✅（deploy.resources） | 維持 |
| 健康檢查 | ✅ | 維持 |
| 多階段建置（小映像） | ✅ | 維持 |

## 7. 稽核與可觀測性

- **稽核事件**：登入/登出/註冊（auth）、策略 chain 建立/發布/刪除（policy-engine）、訂閱/API key
  建立/核准/取消/撤銷（subscription）→ Kafka `auth.events` / `policy.published` / `subscription.events`。
- ✅ **不可變稽核日誌（P3-1 已上線）**：audit-sink consumer → postgres `audit_log`（觸發器禁
  UPDATE/DELETE/TRUNCATE 的 append-only + 每列 hash chain 防竄改）。端到端驗證有資料。保留策略 ≥ 1 年（依需求設定）。
- **追蹤**：OpenTelemetry → Jaeger（已部署）。
- **指標**：Prometheus + Grafana + Alertmanager（已部署）— 建議加上安全告警規則（異常登入率、4xx/5xx 飆升、rate-limit 觸發率）。

## 8. 架構重構路線圖（分階段）

| 階段 | 範圍 | 風險 |
|------|------|------|
| **P0** ✅ | SSDLC 文件、CI/CD 安全閘門、secret scanning、SAST/SCA、容器掃描、安全編碼基線 | 低（不改執行架構） |
| **P1** ✅ | 容器強化（non-root / read-only / cap-drop）、統一錯誤回應、SSRF allow-list、GraphQL complexity | 中 |
| **P2-A** ✅ | **生產 TLS（資料層全部）：Postgres / Redis(含 cluster bus) / MongoDB / Kafka(SASL_SSL) / Elasticsearch** | 中高（已逐服務驗證上線） |
| **P2-B-1** ✅ | **網路多網段分區（edge/app/svc/data，svc+data internal，全參數化可依環境設定）** | 高（已一次性重建驗證；data 層隔離已實證） |
| **P2-B-2** ✅ | **Vault 動態憑證（DB secrets engine 動態簽發 postgres 帳密；4 服務背景續租/輪轉）** | 中高（已上線驗證；fallback 開關 VAULT_DB_CREDS） |
| **P3-1** ✅ | **不可變稽核日誌**（postgres append-only + 觸發器禁改 + hash chain + audit-sink consumer；auth 已發布 login/login_failed/logout/register 事件，端到端驗證有資料） | 中（已上線驗證） |
| **P3-2** ✅ | **自動金鑰輪轉**（Vault KV 版本化 JWT 金鑰，背景輪轉，JWKS 新舊重疊零停機；DB 憑證已於 P2-B-2 動態輪轉） | 中（已上線驗證；JWT_AUTO_ROTATE 開關） |
| **P3-3a** ✅ | 服務間 mTLS — Go 後端 server 端（auth/registry/subscription/policy-engine 於 :9443 強制 mTLS，dual-listener 與 plain port 並存） | 高（已驗證；client 端尚未切換故未端到端強制） |
| **P3-3b-1** ✅ | mTLS client — **gateway** 對 registry/policy-engine/subscription/auth 內部呼叫走 :9443（內部 host 白名單轉址 + client 憑證；JWKS/外部端點除外）。已捕捉 gateway→registry:9443 連線實證 | 高（已驗證；MTLS_ENABLED 開關） |
| **P3-3b-2** ✅ | mTLS client — **bff** 內部呼叫（ServiceClient 單一 chokepoint：undici Pool connect 帶 client 憑證走 :9443）。已驗證帶憑證握手成功、不帶被拒 | 高（已驗證；MTLS_ENABLED 開關） |
| **P3-3b-3** ✅ | Node mTLS servers（gateway/bff dual-listener :9443）+ **nginx upstream mTLS**。端到端驗證 nginx→gateway/bff:9443→後端 全鏈 mTLS（portal/studio UI 層維持 http；JWKS 公鑰維持 plain） | 高（已上線驗證；MTLS_ENABLED 開關、dual-listener 可回滾） |
| **P3-1+** ✅ | 稽核事件產生端擴充：**policy-engine**（policy.published：chain_created/published/deleted）、**subscription**（subscription.events：subscription/apikey 建立/核准/取消/撤銷）比照 auth `internal/audit` 發布至 Kafka（best-effort、async）| 低（純新增） |
| **P4-對外HTTPS** ✅ | nginx 對外 **TLS 1.2/1.3 + HSTS + 80→443 強制轉址**（api/bff/studio/portal）；維運 UI 維持內網 HTTP+Basic Auth | 中（已上線驗證） |
| **P4-備份/告警** ✅ | `scripts/backup.sh`（postgres/audit_log/mongo/vault 備份+SHA256+輪替）；Prometheus `security.yml` 6 條安全告警（5xx/401-403/429/服務離線）| 低（純新增） |
| **P4-Vault AppRole** ✅ | 4 服務以 AppRole periodic token（背景 renew-self）取代 root `VAULT_TOKEN`；policy `apim-svc` 最小授權 + audit device。fallback root 可回滾 | 中高（已上線驗證） |
| **P4-Vault TLS** ✅ | Vault listener TLS（自簽，https-only，http 被拒）；所有 client `VAULT_ADDR=https` + `VAULT_CACERT` 鏈驗證。auto-unseal 需 KMS（保留 Shamir 手動解封）| 高（已上線驗證；重啟需 unseal）|
| **P5-Root CA verify-full** 🟨 **5/6** | 統一內部 **Root CA**（`scripts/gen-root-ca.sh`）簽發各 datastore 憑證 + client 改鏈驗證：**postgres**（4 Go）/ **mongodb**（analytics/notification）/ **vault**（4 服務）/ **elasticsearch**（kibana）/ **kafka**（7 client，Go+Node）皆 verify-full（每個 `Verify code:0` + 端到端驗證、可回滾）| 高（逐 datastore、可回滾；每步上線驗證）|
| **P5-redis** ⚠️ 例外 | **redis 維持自簽 TLS（未採 Root-CA verify-full）**：實測 redis **cluster bus gossip 與自訂 Root CA 不相容**——CA 鏈驗證下節點 TLS 握手成功但 MEET 不收斂（`known_nodes:1`）；自簽（peer==同一張）才能組成 cluster。已回滾為自簽（**加密仍在**、`cluster_state:ok`、client `InsecureSkipVerify` 內網）| 高（cluster bus 信任變更需重組 cluster＝清快取；屬 redis 自身限制，非設定錯誤）|

> **P3-3 服務間 mTLS 主鏈完成**：nginx → gateway/bff → auth/registry/subscription/policy-engine 全程 mTLS（內部 CA、雙向驗證）。剩餘非 mTLS：portal/studio UI 層、JWKS 公鑰端點（低敏感）。

> **P5 結論**：6 個 datastore 中 **5 個達成 Root-CA 鏈驗證（verify-full）**；唯 **redis** 因 cluster bus + 自訂 CA 的相容性限制維持自簽（仍 TLS 加密）。Root-CA verify-full 待 redis 版本支援或架構調整再評估。詳見 [`DEPLOYMENT.md`](../DEPLOYMENT.md) §8.11。

> 本次（P0）聚焦「不改變執行架構」的安全內建；P1–P3 以 issue 追蹤、分批驗證上線，避免破壞既有運行系統。
