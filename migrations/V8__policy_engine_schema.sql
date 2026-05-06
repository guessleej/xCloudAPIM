-- ═══════════════════════════════════════════════════════════════
--  V8: Policy Engine Schema 修正
--  讓 policy_chain_versions 符合 policy-engine store 層預期格式
-- ═══════════════════════════════════════════════════════════════

-- ─── policy_chain_versions 修正 ──────────────────────────────
-- 重命名 snapshot → snapshot_json（store/postgres.go 期望此欄位名）
ALTER TABLE policy_chain_versions
    RENAME COLUMN snapshot TO snapshot_json;

-- 新增 etag 欄位（讓 Gateway 做 conditional GET）
ALTER TABLE policy_chain_versions
    ADD COLUMN IF NOT EXISTS etag VARCHAR(64) NOT NULL DEFAULT '';

-- created_by 改為可 null（publish 時非同步場景不一定有使用者 ID）
ALTER TABLE policy_chain_versions
    ALTER COLUMN created_by DROP NOT NULL;

-- ─── policy_chains 新增 soft delete ──────────────────────────
ALTER TABLE policy_chains
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_chains_deleted
    ON policy_chains(deleted_at) WHERE deleted_at IS NULL;

-- ─── policy_chain_versions 補充索引 ──────────────────────────
CREATE INDEX IF NOT EXISTS idx_chain_versions_updated
    ON policy_chains(updated_at, api_id) WHERE deleted_at IS NULL;
