# 04 — 安全編碼標準

> 對應 NIST SSDF **PW.4 / PW.5**、OWASP ASVS L2
> 範圍：Go（auth / registry / subscription / policy-engine）+ Node/TypeScript（gateway / bff / analytics / notification / portal / studio）

## 0. 通用原則

1. **不信任任何輸入**：所有外部輸入須驗證、正規化、邊界檢查。
2. **Fail-closed**：安全決策失敗時拒絕，而非放行。
3. **最小揭露**：錯誤回應不洩漏堆疊、內部路徑、SQL、版本。
4. **不硬編碼機密**：一律由 Vault / 環境變數注入。
5. **參數化查詢**：永不字串拼接 SQL。
6. **集中授權**：authZ 檢查放在中介層 / 共用函式，不散落。

---

## 1. Go 安全編碼

### 1.1 輸入驗證
```go
// ✅ 使用 binding tag + 明確驗證
type CreateAPIRequest struct {
    Name    string `json:"name" binding:"required,max=128"`
    BaseURL string `json:"base_url" binding:"required,url"`
}
// ✅ URL 驗證（防 SSRF — 見 1.6）
if _, err := url.ParseRequestURI(input); err != nil { /* reject */ }
```

### 1.2 SQL（參數化，禁止拼接）
```go
// ✅ 參數化
db.QueryContext(ctx, "SELECT id FROM apis WHERE org_id = $1 AND id = $2", orgID, apiID)
// ❌ 禁止
db.Query("SELECT * FROM apis WHERE id = '" + id + "'")
```

### 1.3 密鑰 / token 比對（constant-time）
```go
// ✅ 已用於 internal_auth.go
import "crypto/subtle"
if subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 { /* deny */ }
```

### 1.4 錯誤處理（不洩漏內部）
```go
// ✅ 對外統一訊息，內部詳細記錄
h.logger.Error("db query failed", zap.Error(err))      // 內部
c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})  // 對外
```

### 1.5 日誌（不記錄機密）
```go
// ❌ 不可
logger.Info("login", zap.String("password", pw), zap.String("token", tok))
// ✅
logger.Info("login", zap.String("user_id", uid), zap.Bool("mfa", true))
```

### 1.6 SSRF 防護（gateway / 出站呼叫）
```go
// ✅ upstream URL 必須過 allow-list；拒絕私有網段（除非明確允許）
//    169.254.0.0/16 (metadata)、127.0.0.0/8、10/8、172.16/12、192.168/16
```

### 1.7 並行安全
- 共用狀態用 `sync.RWMutex`（如 vault client key cache 已採用）。
- context 傳遞 + 逾時（`context.WithTimeout`）。

### 1.8 Go 工具強制
- `go vet`、`gofmt`、`govulncheck`（CI）、`gosec`（CI SAST）。

---

## 2. Node / TypeScript 安全編碼

### 2.1 輸入驗證（Zod）
```typescript
// ✅ bff / gateway 用 Zod schema 驗證所有外部輸入
const Input = z.object({ apiId: z.string().uuid(), name: z.string().max(128) })
const parsed = Input.safeParse(req.body)
if (!parsed.success) return reply.code(400).send({ error: 'invalid input' })
```

### 2.2 GraphQL 防護（bff）
- **深度限制**：`depth-limit` plugin（已有）。
- **複雜度限制**：加上 query complexity 上限。
- **introspection**：生產關閉。
- **逾時**：resolver 層級逾時，避免長查詢拖垮。

### 2.3 安全 Header（gateway — Helmet）
```typescript
// 目標：啟用 CSP（GraphQL 路由可單獨放寬）
await app.register(helmet, {
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"] } },
  hsts: { maxAge: 31536000, includeSubDomains: true },
})
```

### 2.4 token / API key 比對（timing-safe）
```typescript
import { timingSafeEqual, createHash } from 'node:crypto'
const a = createHash('sha256').update(provided).digest()
const b = createHash('sha256').update(expected).digest()
const ok = a.length === b.length && timingSafeEqual(a, b)
```

### 2.5 SSRF（gateway 轉發）
```typescript
// ✅ 驗證 upstream URL 屬於已註冊 allow-list；阻擋私有/metadata 位址
```

### 2.6 錯誤處理
```typescript
// ✅ 不外洩 stack；統一錯誤格式
app.setErrorHandler((err, req, reply) => {
  req.log.error({ err }, 'request failed')          // 內部
  reply.code(err.statusCode ?? 500).send({ error: 'internal error' })  // 對外
})
```

### 2.7 相依套件
- `npm ci`（鎖定版本），不可 `npm install` 於 CI。
- `npm audit`（CI）。
- 不引入未維護 / 無 CVE 回應的套件。

---

## 3. 機密處理（跨語言）

| 規則 | 說明 |
|------|------|
| 不硬編碼 | 任何 API key / 密碼 / token / 私鑰一律外部注入 |
| 不入版控 | `.env` git-ignored；只留 `.env.example`（佔位值） |
| 不入映像 | 機密以 runtime 環境變數 / volume 注入 |
| 不入日誌 | 見 §1.5 / §5 遮罩規則 |
| pre-commit | 建議啟用 gitleaks pre-commit hook |

---

## 4. 認證 / 授權實作準則

- **每個受保護端點**都要驗證：身分（who）+ 權限（can do）+ 資源歸屬（owns）。
- **BOLA 防護**：操作物件前驗證 `org_id` / `owner_id` 相符（OWASP API1）。
- **scope 檢查**：JWT scope 對應端點所需權限。
- **PKCE**：OAuth2 授權碼流程強制 S256（已實作）。
- **session**：token 僅存 hash；登出即失效。

---

## 5. 日誌與稽核準則

- 安全事件（登入成功/失敗、權限變更、策略發布）必記錄，含：時間、actor、action、resource、結果、來源 IP。
- 遮罩 PII / 機密（見 [05](./05-data-classification.md) §3.3）。
- 稽核日誌與應用日誌分流；稽核日誌目標寫入不可變儲存。

---

## 6. Code Review 安全檢查清單

PR 審查者須確認：
- [ ] 無硬編碼機密
- [ ] 外部輸入皆驗證
- [ ] SQL 參數化
- [ ] authN + authZ + 資源歸屬檢查齊全
- [ ] 錯誤回應不洩漏內部資訊
- [ ] 日誌無機密 / 已遮罩 PII
- [ ] 新相依套件已評估（許可證 + CVE）
- [ ] 安全相關邏輯有測試覆蓋

> 此清單同步於 [`.github/pull_request_template.md`](../../.github/pull_request_template.md)。
