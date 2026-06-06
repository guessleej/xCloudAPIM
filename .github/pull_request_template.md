## Summary

<!-- 簡短說明這個 PR 做了什麼以及為什麼 -->

## Type of Change

- [ ] 🚀 feat — New feature
- [ ] 🐛 fix — Bug fix
- [ ] ♻️  refactor — Code refactoring (no functional change)
- [ ] ⚡ perf — Performance improvement
- [ ] 🧪 test — Test changes
- [ ] 📝 docs — Documentation
- [ ] 🔧 chore — Build/config/tooling
- [ ] 🔒 security — Security fix

## Related Issues

Closes #<!-- issue number -->

## Changes

<!-- 列出主要變更項目 -->

-
-

## Testing

- [ ] Unit tests added / updated
- [ ] Manual testing completed
- [ ] K6 smoke test passes (`make k6-smoke`)
- [ ] Docker Compose starts clean (`docker compose up -d`)

## Checklist

- [ ] Code follows project conventions
- [ ] Self-review completed
- [ ] Migration script follows naming convention (`V{n}__{description}.sql`)
- [ ] `docker-compose.yml` changes validated (`docker compose config`)

## 🔒 Security Review（見 [docs/security/04](../docs/security/04-secure-coding-standards.md)）

- [ ] 無硬編碼機密（密碼 / token / 金鑰）；皆由 Vault / 環境變數注入
- [ ] 所有外部輸入皆經驗證（Zod / binding tag）
- [ ] SQL 一律參數化（無字串拼接）
- [ ] 受保護端點具備 authN + authZ + 資源歸屬檢查（防 BOLA）
- [ ] 錯誤回應不洩漏堆疊 / 內部路徑 / SQL
- [ ] 日誌不含機密、PII 已遮罩
- [ ] 新增相依套件已評估（維護度 + 許可證 + CVE 史）
- [ ] 安全相關邏輯具測試覆蓋
- [ ] 是否觸及威脅模型？若是，已更新 [docs/security/02](../docs/security/02-threat-model.md)

## Screenshots / Logs (if applicable)

<!-- 附上 UI 截圖或 log 輸出 -->
