-- ═══════════════════════════════════════════════════════════════
--  V6: 補齊缺失的複合索引
-- ═══════════════════════════════════════════════════════════════

-- ─── oauth_tokens：清理過期 token 的高頻查詢 ─────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tokens_user_expires
    ON oauth_tokens(user_id, expires_at DESC)
    WHERE revoked_at IS NULL AND user_id IS NOT NULL;

-- ─── subscriptions：複合狀態查詢 ─────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subs_org_status
    ON subscriptions(organization_id, status)
    WHERE status IN ('active', 'pending');

-- ─── subscriptions：按方案查詢活躍訂閱 ───────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subs_plan_status
    ON subscriptions(plan_id, status)
    WHERE status = 'active';

-- ─── oauth_tokens：清理 job 用（非 revoked 且已過期）─────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tokens_cleanup
    ON oauth_tokens(expires_at)
    WHERE revoked_at IS NULL;

-- ─── api_keys：活躍 key 有效期查詢 ───────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_keys_expires
    ON api_keys(expires_at)
    WHERE status = 'active' AND expires_at IS NOT NULL;
