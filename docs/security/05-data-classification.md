# 05 — 資料分類與處理規範

> 對應 NIST SSDF **PW.1**、GDPR / 個人資料保護法

## 1. 分類等級

| 等級 | 標示 | 定義 | 範例 |
|------|------|------|------|
| 極機密 | 🔴 Restricted | 外洩造成重大損害；含認證憑證、金鑰 | 密碼 hash、MFA secret、JWT 私鑰、internal secret |
| 機密 | 🟡 Confidential | 限授權存取的業務資料 | API 定義、策略、訂閱、client_secret hash |
| 內部 | 🟠 Internal | 內部營運資料 | 分析事件、稽核日誌、系統指標 |
| 公開 | 🟢 Public | 可對外 | API 文件、JWKS 公鑰、OpenAPI spec（已發布） |

## 2. 資料盤點（Data Inventory）

| 資料 | 儲存 | 分類 | PII | 加密(靜態) | 加密(傳輸) | 保留期 |
|------|------|------|:---:|:---------:|:---------:|--------|
| password_hash | postgres `users` | 🔴 | ✅ | pgcrypto | 目標 TLS | 帳號存續 |
| mfa_secret | postgres `users` | 🔴 | ✅ | 應用層加密 | 目標 TLS | 帳號存續 |
| email | postgres `users` | 🟡 | ✅ | DB 層 | 目標 TLS | 帳號存續 |
| oauth token hash | postgres / redis | 🔴 | — | hash | 目標 TLS | token TTL |
| JWT 私鑰 | Vault | 🔴 | — | Vault 加密 | 目標 TLS | 至輪轉 |
| session（ip, ua） | redis DB1 | 🟠 | 部分 | — | 目標 TLS | session TTL |
| api.requests 事件 | mongodb / kafka | 🟠 | 可能含 IP | — | 目標 TLS/SASL | 30 天 |
| auth.events | kafka | 🔴 | ✅ | — | 目標 SASL_SSL | ≥ 1 年（稽核） |

## 3. 處理規範

### 3.1 極機密（🔴）
- **絕不**以明文記錄於日誌（密碼、token、金鑰、MFA secret）。
- **絕不**進版控（由 secret scanning 強制）。
- 僅以 hash / 加密形式儲存（password → bcrypt/argon2 via pgcrypto；token → SHA-256）。
- 傳輸需 TLS（生產）。

### 3.2 機密（🟡）/ 內部（🟠）
- 存取需經授權（RBAC + org 隔離）。
- 日誌中遮罩 PII（email → `j***@domain`）。

### 3.3 日誌遮罩規則
| 欄位 | 遮罩方式 |
|------|---------|
| password / token / secret / authorization | 完全移除（不記錄） |
| email | `j***@example.com` |
| IP | 視合規可保留 / 末段遮罩 |
| credit card / 金流 | 不適用（本平台不處理） |

## 4. GDPR / 個資法對應

| 權利 / 要求 | 機制 | 狀態 |
|------------|------|------|
| 存取權 | 使用者資料匯出 API | 待實作 |
| 刪除權（被遺忘） | 帳號刪除 + 級聯清除 | 待實作 |
| 資料可攜 | JSON 匯出 | 待實作 |
| 同意管理 | — | 待實作 |
| 資料外洩通知 | 事件回應流程（72hr） | 見 [08](./08-incident-response.md) |
| 資料最小化 | 僅收集必要欄位 | 設計原則 |

## 5. 資料保留與銷毀

| 資料類別 | 保留期 | 銷毀方式 |
|---------|--------|---------|
| 稽核 / auth 事件 | ≥ 1 年 | 過期後安全刪除 |
| 分析事件 | 30 天（Mongo TTL index） | 自動過期 |
| Session / token | TTL 到期 | Redis 自動過期 |
| 已刪除帳號 | 立即 hash 化 / 匿名化 | 軟刪除 → 硬刪除 |

> 待實作項目以 issue 追蹤（標籤 `compliance`）。
