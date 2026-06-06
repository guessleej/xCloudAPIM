# 02 — 威脅模型（Threat Model）

> 方法論：**STRIDE** + **OWASP API Security Top 10 (2023)**
> 對應 NIST SSDF **PW.1**（設計階段的威脅建模）

## 1. 系統概觀與信任邊界

```
                          Internet (untrusted)
                                 │
        ┌────────────────────────▼────────────────────────┐
        │  TB-1: 邊界（nginx 反向代理 / TLS 終止）            │
        │   - 速率限制、BasicAuth（管理工具）、WAF（建議）    │
        └───┬───────────┬───────────┬───────────┬──────────┘
            │           │           │           │
        ┌───▼───┐   ┌───▼───┐   ┌───▼────┐  ┌───▼────┐
        │gateway│   │  bff  │   │ portal │  │ studio │     TB-2: 應用層
        │ :8080 │   │ :4000 │   │ :3001  │  │  :80   │     (DMZ)
        └───┬───┘   └───┬───┘   └────────┘  └────────┘
            │           │
   ┌────────┴───────────┴─────────────────────────────┐
   │  TB-3: 內部服務網（X-Internal-Token 驗證）          │
   │  ┌──────┐ ┌─────────┐ ┌────────────┐ ┌──────────┐ │
   │  │ auth │ │registry │ │policy-engine│ │subscript.│ │
   │  │:8081 │ │ :8082   │ │   :8083     │ │  :8084   │ │
   │  └──┬───┘ └────┬────┘ └─────┬──────┘ └────┬─────┘ │
   └─────┼──────────┼────────────┼─────────────┼───────┘
         │          │            │             │
   ┌─────▼──────────▼────────────▼─────────────▼───────┐
   │  TB-4: 資料層（密碼/憑證驗證 + 網路隔離）            │
   │  postgres | redis-cluster | mongodb | kafka | ES   │
   │  vault（密鑰管理）                                  │
   └───────────────────────────────────────────────────┘
```

### 信任邊界清單
| 邊界 | 跨越時的控制 |
|------|------------|
| TB-1 Internet → 邊界 | TLS、速率限制、輸入正規化、（建議 WAF） |
| TB-2 邊界 → 應用 | 反代白名單、header 淨化（X-Forwarded-*） |
| TB-3 應用 → 內部服務 | `X-Internal-Token`（constant-time 比對）、JWT |
| TB-4 服務 → 資料層 | 帳密 / 憑證、網路分區（172.28.0.0/16）、最小權限 |

## 2. 主要資產（What we protect）

| 資產 | 位置 | 分類 |
|------|------|------|
| 使用者憑證（password_hash、mfa_secret） | postgres `users` | 🔴 極機密 |
| OAuth token / refresh token（hash） | postgres `oauth_tokens`、redis | 🔴 極機密 |
| JWT 簽章私鑰 | Vault `secret/jwt` | 🔴 極機密 |
| Internal service secret | Vault `secret/internal` | 🔴 極機密 |
| API 定義 / 策略 | postgres、ES | 🟡 機密 |
| 分析事件 / 稽核 | mongodb、kafka | 🟠 內部 |

## 3. STRIDE 分析（依服務）

### 3.1 auth-service（最高風險 — 認證核心）

| STRIDE | 威脅 | 現有控制 | 殘餘風險 / 建議 |
|--------|------|---------|----------------|
| **S**poofing | 偽造身分登入 | password_hash（pgcrypto）、MFA(TOTP)、PKCE 強制 S256 | 建議：登入失敗鎖定、裝置指紋 |
| **T**ampering | 竄改 JWT | RS256 簽章、Vault 私鑰 | ✅ 良好；確保私鑰輪轉 |
| **R**epudiation | 否認操作 | `auth.events` Kafka topic | 建議：稽核日誌不可變儲存（WORM） |
| **I**nfo Disclosure | token / 密鑰外洩 | token 僅存 SHA-256 hash、Vault | 建議：refresh token 輪轉 + 重放偵測 |
| **D**oS | 暴力破解 / 洪水 | Redis rate limit（fail-open）、nginx auth_limit 10r/s | ⚠️ fail-open 在 Redis 故障時失效 → 建議 fail-closed 選項 |
| **E**oP | 權限提升 | RBAC（org/role）、scope 檢查 | 建議：定期權限審查 |

### 3.2 gateway（對外資料平面）

| STRIDE | 威脅 | 現有控制 | 建議 |
|--------|------|---------|------|
| Spoofing | 偽造 API Key | SHA-256 hash 比對 | constant-time 比對驗證 |
| Tampering | 請求竄改 | TLS、policy transform | — |
| Info Disclosure | upstream 錯誤洩漏 | — | ⚠️ 統一錯誤回應、隱藏 stack trace |
| DoS | 流量洪水 | nginx + redis rate limit、under-pressure | ✅ |
| EoP | 繞過策略鏈 | policy-engine chain | 確保 fail-closed |

### 3.3 bff（GraphQL）

| STRIDE | 威脅 | 現有控制 | 建議 |
|--------|------|---------|------|
| DoS | 深度/複雜查詢攻擊 | depth-limit plugin | ✅ 加上 complexity limit + 查詢逾時 |
| Info Disclosure | introspection 洩漏 schema | 預設關閉 | 生產強制關閉 + 持久化查詢（APQ） |
| Tampering | 注入 | Zod 驗證、參數化查詢 | — |

### 3.4 內部服務（registry / policy-engine / subscription）

| STRIDE | 威脅 | 現有控制 | 建議 |
|--------|------|---------|------|
| Spoofing | 偽冒內部呼叫 | `X-Internal-Token` constant-time | ✅；建議升級 mTLS |
| Tampering | 策略竄改 | 內部驗證 + RBAC | 策略變更稽核 |
| Info Disclosure | 內部端點外露 | 網路分區 + token | 確保 nginx 不轉發內部端點 |

## 4. OWASP API Security Top 10 (2023) 對照

| 風險 | 適用性 | 現況 | 行動 |
|------|--------|------|------|
| API1 物件層級授權失效（BOLA） | 高 | RBAC + org 隔離 | 每端點驗證 org ownership |
| API2 認證失效 | 高 | OAuth2/PKCE/MFA | 加上鎖定 + token 輪轉 |
| API3 物件屬性層級授權 | 中 | Zod schema | 明確 allow-list 欄位 |
| API4 資源消耗無限制 | 高 | rate limit、quota | ✅ 補 GraphQL complexity |
| API5 功能層級授權失效 | 高 | scope/role 檢查 | 集中授權中介層 |
| API6 業務流程濫用 | 中 | quota、webhook 驗證 | 異常行為偵測 |
| API7 SSRF | 中 | gateway 轉發 upstream | ⚠️ upstream URL allow-list 驗證 |
| API8 安全設定錯誤 | 高 | — | IaC 掃描、CSP、TLS（見 03） |
| API9 庫存管理不當 | 中 | registry | API 版本/棄用治理 |
| API10 第三方 API 不安全使用 | 中 | — | 出站呼叫驗證 + 逾時 |

## 5. 高優先補強（Top Remediations）

| # | 項目 | 風險 | 對應文件 |
|---|------|------|---------|
| 1 | Kafka / ES / Redis 生產 TLS + SASL | Info Disclosure | [03](./03-secure-architecture.md) |
| 2 | gateway SSRF：upstream URL allow-list | API7 | [04](./04-secure-coding-standards.md) |
| 3 | auth rate-limit fail-closed 選項 | DoS | [04](./04-secure-coding-standards.md) |
| 4 | 統一錯誤回應（隱藏內部細節） | Info Disclosure | [04](./04-secure-coding-standards.md) |
| 5 | refresh token 輪轉 + 重放偵測 | 認證 | [04](./04-secure-coding-standards.md) |
| 6 | 不可變稽核日誌 | Repudiation | [03](./03-secure-architecture.md) |
| 7 | 升級內部通訊為 mTLS | Spoofing | [03](./03-secure-architecture.md) |

> 本表追蹤於 GitHub issues，標籤 `security` + `hardening`。
