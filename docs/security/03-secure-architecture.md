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
| Internet → nginx | HTTP（開發） | **TLS 1.2+（強制 HTTPS 轉址）** |
| nginx → 應用服務 | HTTP | TLS 或維持內網 + mTLS |
| 服務 → postgres | ✅ **`sslmode=require`（TLSv1.3，P2-A 已上線）** | `sslmode=verify-full`（生產換正式 CA） |
| 服務 → redis | ✅ **TLS + requirepass（cluster bus 亦 TLS，P2-A 已上線）** | 同（生產換正式 CA） |
| 服務 → mongodb | ✅ **TLS（allowTLS，P2-A 已上線；app client tls=true）** | requireTLS（生產換正式 CA） |
| 服務 → kafka | ✅ **SASL_SSL（SASL/PLAIN + TLS，P2-A 已上線）** | 同（生產換正式 CA / SCRAM） |
| 服務 → elasticsearch | ✅ **HTTPS（xpack.security.http.ssl，P2-A 已上線）** | 同（生產換正式 CA 憑證） |
| 服務 → vault | HTTP（開發） | **HTTPS（config.hcl TLS 段）** |

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
- 現階段：`X-Internal-Token = hex(SHA256(INTERNAL_SERVICE_SECRET))`，constant-time 比對。
- **目標：mTLS** — 每服務一張憑證，由內部 CA 簽發，雙向驗證。

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

- **稽核事件**：登入、權限變更、策略發布、訂閱變更 → Kafka `auth.events` / `policy.published`。
- **建議**：稽核日誌寫入**不可變**儲存（append-only / WORM），保留 ≥ 1 年。
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
| **P3-1** ✅ | **不可變稽核日誌**（postgres append-only + 觸發器禁改 + hash chain + audit-sink consumer） | 中（已上線驗證；稽核 topics 待服務端產生事件） |
| **P3-2** ✅ | **自動金鑰輪轉**（Vault KV 版本化 JWT 金鑰，背景輪轉，JWKS 新舊重疊零停機；DB 憑證已於 P2-B-2 動態輪轉） | 中（已上線驗證；JWT_AUTO_ROTATE 開關） |
| **P3-3a** ✅ | 服務間 mTLS — Go 後端 server 端（auth/registry/subscription/policy-engine 於 :9443 強制 mTLS，dual-listener 與 plain port 並存） | 高（已驗證；client 端尚未切換故未端到端強制） |
| **P3-3b-1** ✅ | mTLS client — **gateway** 對 registry/policy-engine/subscription/auth 內部呼叫走 :9443（內部 host 白名單轉址 + client 憑證；JWKS/外部端點除外）。已捕捉 gateway→registry:9443 連線實證 | 高（已驗證；MTLS_ENABLED 開關） |
| **P3-3b-2** ✅ | mTLS client — **bff** 內部呼叫（ServiceClient 單一 chokepoint：undici Pool connect 帶 client 憑證走 :9443）。已驗證帶憑證握手成功、不帶被拒 | 高（已驗證；MTLS_ENABLED 開關） |
| **P3-3b-3** ✅ | Node mTLS servers（gateway/bff dual-listener :9443）+ **nginx upstream mTLS**。端到端驗證 nginx→gateway/bff:9443→後端 全鏈 mTLS（portal/studio UI 層維持 http；JWKS 公鑰維持 plain） | 高（已上線驗證；MTLS_ENABLED 開關、dual-listener 可回滾） |

> **P3-3 服務間 mTLS 主鏈完成**：nginx → gateway/bff → auth/registry/subscription/policy-engine 全程 mTLS（內部 CA、雙向驗證）。剩餘非 mTLS：portal/studio UI 層、JWKS 公鑰端點（低敏感）。

> 本次（P0）聚焦「不改變執行架構」的安全內建；P1–P3 以 issue 追蹤、分批驗證上線，避免破壞既有運行系統。
