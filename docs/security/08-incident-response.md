# 08 — 資安事件回應（Incident Response）

> 對應 NIST SSDF **RV.3**、NIST SP 800-61

## 1. 事件分級

| 等級 | 定義 | 範例 | 通報時限 |
|------|------|------|---------|
| **SEV-1** | 重大外洩 / 全面中斷 | 資料庫外洩、金鑰外洩、認證繞過遭利用 | 立即（< 15 分） |
| **SEV-2** | 部分影響 / 高風險 | 單服務遭入侵、可利用之 RCE | < 1 小時 |
| **SEV-3** | 有限影響 | 受限的資訊洩漏、DoS 緩解中 | < 4 小時 |
| **SEV-4** | 低風險 | 掃描告警、可疑但未證實 | 次工作日 |

## 2. 回應流程（PICERL）

```
Prepare → Identify → Contain → Eradicate → Recover → Lessons Learned
準備      識別        遏制       根除         復原       檢討
```

### 2.1 Identify（識別）
- 來源：監控告警（Prometheus/Alertmanager）、日誌（ES/Kibana）、追蹤（Jaeger）、外部回報。
- 確認範圍：受影響服務、資料、使用者。

### 2.2 Contain（遏制）
- **金鑰外洩** → 立即於 Vault 輪轉（JWT 私鑰 / internal secret / DB 帳密）。
- **服務遭入侵** → 隔離容器、撤銷其憑證、封鎖來源 IP（nginx）。
- **token 外洩** → 撤銷 session（清 redis）、強制重新登入。

### 2.3 Eradicate（根除）
- 修補根因（漏洞 / 設定錯誤）。
- 確認無持久化後門。

### 2.4 Recover（復原）
- 從乾淨映像重建服務。
- 還原資料（如需）並驗證完整性。
- 加強監控觀察期。

### 2.5 Lessons Learned（檢討）
- 事件後 5 個工作天內完成 post-mortem（無究責文化）。
- 產出：時間軸、根因、改進項（納入 backlog）。

## 3. 金鑰 / 機密輪轉快速指引

| 機密 | 輪轉步驟 |
|------|---------|
| JWT 私鑰 | Vault 寫入新金鑰對 → auth 重載 → 舊 JWT 隨 TTL 過期 |
| Internal secret | 更新 Vault + 各服務環境變數 → 滾動重啟 |
| DB 密碼 | `ALTER USER` → 更新 Vault/env → 滾動重啟 |
| Redis / Mongo 密碼 | 更新服務設定 → 滾動重啟 |
| 外洩於 git 的機密 | **立即輪轉**（git 歷史無法視為已清除）+ 從歷史移除 |

## 4. 通訊

| 對象 | 時機 | 負責 |
|------|------|------|
| 內部團隊 | 事件確認時 | IC（Incident Commander） |
| 受影響使用者 | 確認個資外洩後（GDPR 72 小時） | PO + 法務 |
| 主管機關 | 法規要求時（72 小時內） | PO + 法務 |
| 大眾 | 必要時 | PO |

## 5. 聯絡與角色

| 角色 | 職責 |
|------|------|
| Incident Commander（IC） | 統籌、決策、對外窗口 |
| Tech Lead | 技術遏制與根除 |
| Security Team | 鑑識、影響評估 |
| PO | 業務 / 法規 / 對外溝通決策 |

> 實際聯絡資訊維護於內部（不入版控）。

## 6. 演練

- 每半年一次桌面演練（tabletop），情境涵蓋金鑰外洩、資料外洩、服務入侵。
- 演練後更新本文件與 runbook。

## 7. 證據保全

- 保留相關日誌、容器映像快照、記憶體 dump（如可行）。
- 維持監管鏈（chain of custody）。
- 日誌保留 ≥ 1 年（稽核需求）。
