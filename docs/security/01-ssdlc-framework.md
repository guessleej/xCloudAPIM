# 01 — SSDLC 治理與流程框架

> 對應 NIST SSDF **PO（Prepare the Organization）**、OWASP SAMM **Governance**

## 1. 目的

定義 xCloudAPIM 平台從需求到維運的安全活動、角色責任（RACI）與通過準則（Definition of Done / Security Gate）。

## 2. 角色與責任（RACI）

| 活動 | 開發者 | Tech Lead | Security Team | PO |
|------|:------:|:---------:|:-------------:|:--:|
| 安全需求定義 | C | A | C | R |
| 威脅建模 | R | A | C | I |
| 安全編碼 | R | A | I | I |
| Code Review（含安全） | R | A | C | I |
| 安全測試（SAST/SCA/DAST） | R | C | A | I |
| 漏洞修補 | R | A | C | I |
| 事件回應 | C | C | A/R | I |
| 例外核准（風險接受） | I | C | A | R |

R=執行 A=當責 C=諮詢 I=告知

## 3. SSDLC 階段與「安全完成準則」

### 3.1 規劃 / 需求
- [ ] 識別處理的資料分類（見 [05](./05-data-classification.md)）
- [ ] 定義 abuse case / misuse case（不只 happy path）
- [ ] 確認法規適用性（GDPR、個資法）

### 3.2 設計
- [ ] 完成或更新威脅模型（見 [02](./02-threat-model.md)）
- [ ] 信任邊界、認證/授權方式在設計中明確
- [ ] 新外部相依套件經過評估（許可證 + 維護度 + CVE 史）

### 3.3 實作
- [ ] 遵循安全編碼標準（見 [04](./04-secure-coding-standards.md)）
- [ ] 不硬編碼任何密鑰（由 Vault / 環境變數注入）
- [ ] 通過 pre-commit / CI 的 secret scanning

### 3.4 驗證
- [ ] SAST 無 High/Critical（CodeQL、gosec、semgrep）
- [ ] SCA 無未豁免的 High/Critical（govulncheck、npm audit、trivy）
- [ ] 安全相關單元測試覆蓋（authN/authZ、輸入驗證）
- [ ] 容器映像掃描通過

### 3.5 部署
- [ ] 產生並保存 SBOM
- [ ] 映像簽章（生產）
- [ ] 機密由 Vault 注入，非映像內建
- [ ] 最小權限執行（non-root、read-only fs、drop capabilities）

### 3.6 維運
- [ ] Dependabot 啟用且 PR 及時處理
- [ ] 每日排程安全掃描（security.yml schedule）
- [ ] 稽核日誌與告警運作中

## 4. 安全閘門（Security Gates）

| 閘門 | 觸發時機 | 阻擋條件 | 例外機制 |
|------|---------|---------|---------|
| Secret Scan | 每次 push / PR | 偵測到任何明文密鑰 | 無例外，必須移除並輪轉 |
| SAST | PR | High/Critical 發現 | `@security-team` 標記 false-positive |
| SCA | PR + 每日 | 未豁免之 High/Critical CVE | `.trivyignore` / 文件化豁免 |
| Container Scan | push to main | Critical OS/lib 漏洞 | 文件化豁免 + 修補計畫 |
| DAST | nightly / pre-release | High 以上 | 風險接受需 PO 簽核 |

## 5. 風險接受流程

當無法在 SLA 內修補時：
1. 開立 risk-acceptance issue（標籤 `security`、`risk-accepted`）。
2. 記錄：CVE/發現、影響、補償控制、到期重評日期。
3. 由 `@security-team` + PO 核准。
4. 於 `.trivyignore` 或對應豁免檔註明 issue 連結與到期日。

## 6. 訓練

- 新進工程師：OWASP Top 10 + 本 SSDLC 文件導讀。
- 每年一次安全編碼複訓。
- 重大事件後的 lessons-learned 分享。

## 7. 度量指標（Metrics）

| 指標 | 目標 |
|------|------|
| Critical 漏洞 MTTR | < 7 天 |
| PR 安全閘門通過率 | > 95%（一次通過） |
| 相依套件過期率（High CVE） | < 5% |
| 威脅模型覆蓋率（服務數） | 100% 核心服務 |
