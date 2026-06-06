# 07 — 安全測試

> 對應 NIST SSDF **PW.7（Code Review）/ PW.8（Testing）**、OWASP SAMM **Verification**

## 1. 測試金字塔（安全視角）

```
        ┌───────────────────────┐
        │  滲透測試（年度/重大）   │  人工，pre-release
        ├───────────────────────┤
        │  DAST（nightly）       │  ZAP baseline 掃描
        ├───────────────────────┤
        │  SAST + IaC（每 PR）   │  CodeQL / gosec / semgrep / trivy config
        ├───────────────────────┤
        │  SCA（每 PR + 每日）   │  govulncheck / npm audit / trivy
        ├───────────────────────┤
        │  安全單元測試（每 PR）  │  authN/authZ / 輸入驗證 / PKCE
        └───────────────────────┘
```

## 2. 各層工具與閘門

| 類型 | 工具 | 範圍 | 閘門 | Workflow |
|------|------|------|------|----------|
| Secret Scan | gitleaks | 全 repo + 歷史 | 偵測即失敗 | security.yml |
| SAST | CodeQL | JS/TS + Go | High/Critical 失敗 | security.yml |
| SAST | gosec | Go 服務 | High 失敗 | security.yml |
| SAST | semgrep | 全語言 OWASP rules | High 失敗 | security.yml |
| SCA | govulncheck | Go 模組 | 任何可達漏洞失敗 | security.yml |
| SCA | npm audit | Node 服務 | Critical 失敗 | security.yml |
| SCA + 容器 | Trivy fs / image | 相依 + OS | Critical 失敗 | security.yml |
| IaC | Trivy config | Dockerfile / compose | 設定錯誤 | security.yml |
| DAST | OWASP ZAP | 執行中服務 | High 警示 | security.yml（nightly） |
| 相依審查 | dependency-review | PR 新增相依 | High + 禁用許可證 | security.yml（PR） |

## 3. 安全單元測試要求

每個服務針對以下須有測試：
- **認證**：有效 / 無效 / 過期 token；缺 token。
- **授權**：跨 org 存取被拒（BOLA）；scope 不足被拒。
- **輸入驗證**：邊界值、惡意 payload（過長、特殊字元、注入樣式）。
- **內部驗證**：缺 / 錯誤 `X-Internal-Token` 被拒（已有 `internal_auth`）。
- **PKCE**：plain method 被拒（已有 `pkce_test.go`）。

範例（Go）：
```go
func TestInternalAuth_RejectsMissingToken(t *testing.T) { /* 401 */ }
func TestInternalAuth_RejectsWrongToken(t *testing.T)   { /* 403 */ }
```

## 4. DAST（OWASP ZAP Baseline）

- 對 `gateway` / `bff` / `portal` 執行 ZAP baseline（被動掃描 + 常見主動規則）。
- nightly 排程，避免阻擋日常 PR。
- 報告上傳為 artifact；High 以上開 issue。

## 5. 滲透測試

- **頻率**：每年至少一次，或重大架構變更後。
- **範圍**：對外入口（nginx → gateway/bff/portal）、認證流程、多租戶隔離。
- **結果**：發現項納入漏洞管理流程（見 [06](./06-vulnerability-management.md)）。

## 6. 測試資料

- 嚴禁使用真實生產資料於測試。
- 使用合成 / 匿名化資料（見 `seeds/`）。
- 測試用假密鑰需於 `.gitleaks.toml` allowlist 標記，避免誤報。

## 7. 本地執行（shift-left）

開發者可於提交前本地執行：
```bash
# Go
govulncheck ./...
gosec ./...
# Node
npm audit --omit=dev
# 容器 / 機密
trivy fs --scanners vuln,secret,misconfig .
gitleaks detect --source . --no-banner
```
建議透過 [`scripts/dev-doctor.sh`](../../scripts/dev-doctor.sh) 整合。
