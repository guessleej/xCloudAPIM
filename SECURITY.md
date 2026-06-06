# Security Policy

## 支援版本

| 版本 | 安全更新支援 |
|------|------------|
| `main`（最新） | ✅ |
| 其他 | ❌ |

## 回報漏洞（Vulnerability Disclosure）

我們重視所有安全問題的回報。**請勿**透過公開的 GitHub Issue 回報安全漏洞。

請改用以下管道：

1. **GitHub Private Vulnerability Reporting**（建議）
   於本 repo 的 `Security` 分頁 → `Report a vulnerability`。
2. **Email**：`security@cloudinfo.com.tw`（如可用 PGP 請附加）。

回報時請盡量提供：

- 受影響的服務 / 端點 / 檔案
- 重現步驟或 PoC
- 影響評估（資料外洩、權限提升、DoS…）
- 建議的修補方向（若有）

## 我們的承諾（SLA）

| 階段 | 目標時間 |
|------|---------|
| 確認收到回報 | 2 個工作天內 |
| 初步影響評估 | 5 個工作天內 |
| Critical 修補 | 7 天內 |
| High 修補 | 30 天內 |
| Medium / Low 修補 | 90 天內 |

詳細的內部漏洞處理流程見
[`docs/security/06-vulnerability-management.md`](./docs/security/06-vulnerability-management.md)。

## 安全發展實務

本專案採用完整 SSDLC，文件見 [`docs/security/`](./docs/security/)。
所有 PR 皆須通過自動化安全閘門（SAST、SCA、secret scanning、容器掃描）。

## 名譽榜（Hall of Fame）

我們會在取得回報者同意後，於此記錄負責任揭露的研究者。
