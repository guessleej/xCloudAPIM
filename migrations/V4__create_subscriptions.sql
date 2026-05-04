-- ═══════════════════════════════════════════════════════════════
--  V4: 訂閱、方案與配額管理
-- ═══════════════════════════════════════════════════════════════

-- ─── ENUM ────────────────────────────────────────────────────
CREATE TYPE plan_type             AS ENUM ('free', 'basic', 'pro', 'enterprise', 'custom');
CREATE TYPE subscription_status   AS ENUM ('pending', 'active', 'suspended', 'expired', 'cancelled');
CREATE TYPE api_key_status        AS ENUM ('active', 'revoked', 'expired');
CREATE TYPE quota_period          AS ENUM ('minute', 'hour', 'day', 'month');
CREATE TYPE billing_cycle         AS ENUM ('monthly', 'yearly', 'pay_as_you_go');

-- ─── 訂閱方案定義 ─────────────────────────────────────────────
CREATE TABLE plans (
    id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name              plan_type   NOT NULL UNIQUE,
    display_name      VARCHAR(50) NOT NULL,
    description       TEXT,
    -- 速率限制
    rpm_limit         BIGINT      NOT NULL DEFAULT 100,       -- requests/minute
    rph_limit         BIGINT,                                 -- requests/hour
    rpd_limit         BIGINT      NOT NULL DEFAULT 10000,     -- requests/day
    rpm_limit_month   BIGINT,                                 -- requests/month (-1 = unlimited)
    burst_multiplier  DECIMAL(3,1) NOT NULL DEFAULT 1.5,
    -- 功能開關
    features          JSONB        NOT NULL DEFAULT '{}',
    max_api_keys      INT          NOT NULL DEFAULT 1,
    max_apps          INT          NOT NULL DEFAULT 1,
    -- 計費
    billing_cycle     billing_cycle NOT NULL DEFAULT 'monthly',
    price_cents       INT           NOT NULL DEFAULT 0,       -- 0 = free
    currency          CHAR(3)       NOT NULL DEFAULT 'USD',
    -- 狀態
    is_public         BOOLEAN       NOT NULL DEFAULT TRUE,
    is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
    sort_order        INT           NOT NULL DEFAULT 100,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── 預設方案資料 ─────────────────────────────────────────────
INSERT INTO plans (name, display_name, description, rpm_limit, rpd_limit, max_api_keys, max_apps, price_cents, sort_order, features) VALUES
('free',       'Free',       '個人開發使用', 100,    10000,    1,  1,  0,       1,
 '{"analytics_days":7,"support":"community","sla":null}'),
('basic',      'Basic',      '小型應用',     1000,   100000,   3,  3,  2900,    2,
 '{"analytics_days":30,"support":"email","sla":"99.9%"}'),
('pro',        'Pro',        '中型商業應用', 10000,  -1,       10, 10, 9900,    3,
 '{"analytics_days":90,"support":"priority","sla":"99.95%","custom_domain":true}'),
('enterprise', 'Enterprise', '企業級方案',   -1,     -1,       -1, -1, -1,      4,
 '{"analytics_days":365,"support":"dedicated","sla":"99.99%","custom_domain":true,"sso":true,"audit_log":true}');

-- ─── 訂閱主表 ─────────────────────────────────────────────────
CREATE TABLE subscriptions (
    id               UUID                 PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id  UUID                 NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    api_id           UUID                 NOT NULL REFERENCES apis(id) ON DELETE CASCADE,
    plan_id          UUID                 NOT NULL REFERENCES plans(id),
    subscriber_id    UUID                 NOT NULL REFERENCES users(id),  -- 申請人
    status           subscription_status  NOT NULL DEFAULT 'pending',
    -- 有效期
    start_date       DATE                 NOT NULL DEFAULT CURRENT_DATE,
    end_date         DATE,                -- null = 永久
    -- 審核
    approved_by      UUID                 REFERENCES users(id),
    approved_at      TIMESTAMPTZ,
    rejected_reason  TEXT,
    -- 備註
    notes            TEXT,
    metadata         JSONB                NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, api_id)      -- 每個 org 只能有一個 active 訂閱
);

-- ─── API Key 管理 ─────────────────────────────────────────────
CREATE TABLE api_keys (
    id               UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscription_id  UUID           NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    organization_id  UUID           NOT NULL REFERENCES organizations(id),
    -- Key 資料
    key_hash         TEXT           NOT NULL UNIQUE,    -- SHA-256(api_key)
    key_prefix       CHAR(8)        NOT NULL,           -- 顯示用前綴 e.g. xca_xxxx
    name             VARCHAR(100)   NOT NULL DEFAULT 'Default',
    description      TEXT,
    status           api_key_status NOT NULL DEFAULT 'active',
    -- 限制
    allowed_ips      INET[]         NOT NULL DEFAULT '{}',  -- 空 = 不限制
    allowed_origins  TEXT[]         NOT NULL DEFAULT '{}',
    scopes           TEXT[]         NOT NULL DEFAULT '{}',
    -- 過期
    expires_at       TIMESTAMPTZ,
    last_used_at     TIMESTAMPTZ,
    last_used_ip     INET,
    -- 稽核
    created_by       UUID           NOT NULL REFERENCES users(id),
    revoked_by       UUID           REFERENCES users(id),
    revoked_at       TIMESTAMPTZ,
    revoke_reason    TEXT,
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ─── 配額使用量統計（每日快照） ───────────────────────────────
CREATE TABLE quota_usage_daily (
    id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscription_id  UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    api_id           UUID        NOT NULL REFERENCES apis(id),
    usage_date       DATE        NOT NULL,
    request_count    BIGINT      NOT NULL DEFAULT 0,
    success_count    BIGINT      NOT NULL DEFAULT 0,
    error_count      BIGINT      NOT NULL DEFAULT 0,
    total_bytes_in   BIGINT      NOT NULL DEFAULT 0,
    total_bytes_out  BIGINT      NOT NULL DEFAULT 0,
    avg_latency_ms   DECIMAL(10,2),
    p95_latency_ms   DECIMAL(10,2),
    p99_latency_ms   DECIMAL(10,2),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(subscription_id, api_id, usage_date)
);

-- ─── 配額使用量（每月彙總） ───────────────────────────────────
CREATE TABLE quota_usage_monthly (
    id               UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscription_id  UUID    NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    api_id           UUID    NOT NULL REFERENCES apis(id),
    year_month       CHAR(7) NOT NULL,              -- e.g. 2026-04
    request_count    BIGINT  NOT NULL DEFAULT 0,
    error_count      BIGINT  NOT NULL DEFAULT 0,
    over_quota_count BIGINT  NOT NULL DEFAULT 0,    -- 超出配額被拒絕的次數
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(subscription_id, api_id, year_month)
);

-- ─── 訂閱變更日誌 ─────────────────────────────────────────────
CREATE TABLE subscription_audit_log (
    id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscription_id  UUID         NOT NULL REFERENCES subscriptions(id),
    action           VARCHAR(50)  NOT NULL,  -- created|approved|suspended|plan_changed|etc.
    old_value        JSONB,
    new_value        JSONB,
    performed_by     UUID         REFERENCES users(id),
    performed_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    ip_address       INET,
    reason           TEXT
);

-- ─── Indexes ─────────────────────────────────────────────────
CREATE INDEX idx_subs_org_api      ON subscriptions(organization_id, api_id);
CREATE INDEX idx_subs_status       ON subscriptions(status);
CREATE INDEX idx_subs_plan         ON subscriptions(plan_id);
CREATE INDEX idx_api_keys_hash     ON api_keys(key_hash);
CREATE INDEX idx_api_keys_prefix   ON api_keys(key_prefix);
CREATE INDEX idx_api_keys_sub      ON api_keys(subscription_id) WHERE status = 'active';
CREATE INDEX idx_quota_daily_date  ON quota_usage_daily(subscription_id, usage_date DESC);
CREATE INDEX idx_quota_monthly     ON quota_usage_monthly(subscription_id, year_month DESC);

-- ─── Triggers ────────────────────────────────────────────────
CREATE TRIGGER trg_plans_updated_at
    BEFORE UPDATE ON plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_api_keys_updated_at
    BEFORE UPDATE ON api_keys
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── 自動記錄訂閱變更 ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION log_subscription_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status OR OLD.plan_id IS DISTINCT FROM NEW.plan_id THEN
        INSERT INTO subscription_audit_log(subscription_id, action, old_value, new_value)
        VALUES (NEW.id,
            CASE
                WHEN OLD.status IS DISTINCT FROM NEW.status THEN 'status_changed'
                ELSE 'plan_changed'
            END,
            jsonb_build_object('status', OLD.status, 'plan_id', OLD.plan_id),
            jsonb_build_object('status', NEW.status, 'plan_id', NEW.plan_id)
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_subscription_audit
    AFTER UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION log_subscription_changes();
