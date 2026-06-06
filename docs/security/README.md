# xCloudAPIM — 安全軟體開發生命週期（SSDLC）

本目錄定義 xCloudAPIM 平台的 **Secure Software Development Life Cycle（SSDLC）**，
對齊 **NIST SP 800-218（SSDF）**、**OWASP SAMM v2** 與 **OWASP ASVS L2**。

目標：把安全控制**內建（shift-left）** 進每個開發階段，而非事後補救。

---

## 文件索引

| # | 文件 | 對應 SSDLC 階段 | NIST SSDF |
|---|------|----------------|-----------|
| 01 | [ssdlc-framework.md](./01-ssdlc-framework.md) | 治理與流程總覽 | PO |
| 02 | [threat-model.md](./02-threat-model.md) | 設計（Design） | PW.1 |
| 03 | [secure-architecture.md](./03-secure-architecture.md) | 設計（Design） | PW.1 / PO.5 |
| 04 | [secure-coding-standards.md](./04-secure-coding-standards.md) | 實作（Implement） | PW.4 / PW.5 |
| 05 | [data-classification.md](./05-data-classification.md) | 設計 / 實作 | PW.1 |
| 06 | [vulnerability-management.md](./06-vulnerability-management.md) | 維運（Maintain） | RV |
| 07 | [security-testing.md](./07-security-testing.md) | 驗證（Verify） | PW.7 / PW.8 |
| 08 | [incident-response.md](./08-incident-response.md) | 回應（Respond） | RV.3 |

另見根目錄 [`SECURITY.md`](../../SECURITY.md)：對外漏洞揭露政策。

---

## SSDLC 階段與自動化閘門對照

```
┌──────────┬──────────────┬──────────────────────────────┬─────────────────────┐
│ 階段      │ 活動          │ 自動化閘門（CI/CD）            │ 文件                 │
├──────────┼──────────────┼──────────────────────────────┼─────────────────────┤
│ 規劃/需求 │ 安全需求      │ —                            │ 01, 05              │
│ 設計      │ 威脅建模      │ —（PR 審查 checklist）        │ 02, 03              │
│ 實作      │ 安全編碼      │ SAST / secret scan / lint    │ 04                  │
│ 建置      │ 相依管理      │ SCA（govulncheck/npm/trivy）  │ 06                  │
│ 測試      │ 安全測試      │ DAST / 容器掃描 / IaC 掃描    │ 07                  │
│ 部署      │ 安全部署      │ image sign / SBOM            │ 03, 06              │
│ 維運      │ 監控/修補      │ Dependabot / 排程掃描        │ 06, 08              │
└──────────┴──────────────┴──────────────────────────────┴─────────────────────┘
```

對應的 CI/CD workflow：
- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) — 建置、測試、lint
- [`.github/workflows/security.yml`](../../.github/workflows/security.yml) — SAST、SCA、secret、容器、IaC 掃描

---

## 採用標準

- **NIST SP 800-218** Secure Software Development Framework（SSDF）
- **OWASP SAMM v2** — 成熟度治理模型
- **OWASP ASVS 4.0 Level 2** — 應用安全驗證標準
- **OWASP API Security Top 10 (2023)** — 本平台為 API 管理平台，特別重要
- **CIS Docker Benchmark** — 容器強化

## 維護

- 本文件集每季審查一次，或在重大架構變更後更新。
- 變更需經 `@security-team`（見 [CODEOWNERS](../../.github/CODEOWNERS)）審查。
