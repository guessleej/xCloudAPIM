-- ═══════════════════════════════════════════════════════════════
--  V1: 使用者與角色系統
-- ═══════════════════════════════════════════════════════════════

-- ─── Extension ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- 模糊搜尋

-- ─── ENUM ────────────────────────────────────────────────────
CREATE TYPE user_status AS ENUM ('active', 'inactive', 'suspended', 'pending_verify');
CREATE TYPE user_role   AS ENUM ('super_admin', 'admin', 'developer', 'viewer', 'billing');

-- ─── 使用者主表 ───────────────────────────────────────────────
CREATE TABLE users (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           VARCHAR(255) NOT NULL UNIQUE,
    display_name    VARCHAR(100) NOT NULL,
    password_hash   TEXT,                           -- nullable（OAuth 登入者）
    status          user_status  NOT NULL DEFAULT 'pending_verify',
    email_verified  BOOLEAN      NOT NULL DEFAULT FALSE,
    avatar_url      TEXT,
    timezone        VARCHAR(64)  NOT NULL DEFAULT 'Asia/Taipei',
    language        VARCHAR(10)  NOT NULL DEFAULT 'zh-TW',
    last_login_at   TIMESTAMPTZ,
    last_login_ip   INET,
    mfa_enabled     BOOLEAN      NOT NULL DEFAULT FALSE,
    mfa_secret      TEXT,                           -- TOTP secret（加密儲存）
    metadata        JSONB        NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ                     -- soft delete
);

-- ─── 組織 ────────────────────────────────────────────────────
CREATE TABLE organizations (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name         VARCHAR(100) NOT NULL UNIQUE,
    slug         VARCHAR(100) NOT NULL UNIQUE,
    description  TEXT,
    logo_url     TEXT,
    plan_type    VARCHAR(50)  NOT NULL DEFAULT 'free',
    max_members  INT          NOT NULL DEFAULT 5,
    metadata     JSONB        NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at   TIMESTAMPTZ
);

-- ─── 組織成員 ─────────────────────────────────────────────────
CREATE TABLE organization_members (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            user_role   NOT NULL DEFAULT 'developer',
    invited_by      UUID        REFERENCES users(id),
    joined_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

-- ─── 使用者會話 ───────────────────────────────────────────────
CREATE TABLE user_sessions (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT        NOT NULL UNIQUE,       -- SHA-256(refresh_token)
    user_agent   TEXT,
    ip_address   INET,
    expires_at   TIMESTAMPTZ  NOT NULL,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── 使用者通知設定 ───────────────────────────────────────────
CREATE TABLE user_notification_settings (
    user_id              UUID     PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    quota_alert_email    BOOLEAN  NOT NULL DEFAULT TRUE,
    quota_alert_webhook  BOOLEAN  NOT NULL DEFAULT FALSE,
    error_alert_email    BOOLEAN  NOT NULL DEFAULT TRUE,
    api_key_expiry_email BOOLEAN  NOT NULL DEFAULT TRUE,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ─────────────────────────────────────────────────
CREATE INDEX idx_users_email        ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_status       ON users(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_created_at   ON users(created_at DESC);
CREATE INDEX idx_org_members_user   ON organization_members(user_id);
CREATE INDEX idx_org_members_org    ON organization_members(organization_id);
CREATE INDEX idx_sessions_user      ON user_sessions(user_id);
CREATE INDEX idx_sessions_token     ON user_sessions(token_hash);
CREATE INDEX idx_sessions_expires   ON user_sessions(expires_at) WHERE revoked_at IS NULL;

-- ─── updated_at 自動更新 function ────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_organizations_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
