-- ═══════════════════════════════════════════════════════════════
--  V5: OAuth 2.0 / OIDC 客戶端與 Token 管理
-- ═══════════════════════════════════════════════════════════════

-- ─── ENUM ────────────────────────────────────────────────────
CREATE TYPE grant_type        AS ENUM ('authorization_code', 'client_credentials', 'refresh_token', 'implicit', 'device_code');
CREATE TYPE token_type        AS ENUM ('access_token', 'refresh_token', 'authorization_code', 'device_code');
CREATE TYPE client_auth_method AS ENUM ('client_secret_basic', 'client_secret_post', 'private_key_jwt', 'none');

-- ─── OAuth2 Client 主表 ───────────────────────────────────────
CREATE TABLE oauth_clients (
    id               UUID               PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id  UUID               NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    subscription_id  UUID               REFERENCES subscriptions(id) ON DELETE SET NULL,
    -- 識別資料
    client_id        VARCHAR(100)       NOT NULL UNIQUE,   -- 公開 ID
    client_secret_hash TEXT,                               -- SHA-256(secret)，null = PKCE only
    client_name      VARCHAR(200)       NOT NULL,
    description      TEXT,
    logo_uri         TEXT,
    -- OAuth2 設定
    grant_types      grant_type[]       NOT NULL DEFAULT '{authorization_code}',
    redirect_uris    TEXT[]             NOT NULL DEFAULT '{}',
    post_logout_uris TEXT[]             NOT NULL DEFAULT '{}',
    scopes           TEXT[]             NOT NULL DEFAULT '{openid,profile,email}',
    -- 安全設定
    token_endpoint_auth_method client_auth_method NOT NULL DEFAULT 'client_secret_basic',
    require_pkce     BOOLEAN            NOT NULL DEFAULT TRUE,
    response_types   TEXT[]             NOT NULL DEFAULT '{code}',
    -- Token 設定
    access_token_ttl  INT               NOT NULL DEFAULT 3600,
    refresh_token_ttl INT               NOT NULL DEFAULT 86400,
    id_token_ttl      INT               NOT NULL DEFAULT 3600,
    -- 多租戶
    allowed_origins  TEXT[]             NOT NULL DEFAULT '{}',
    -- 狀態
    active           BOOLEAN            NOT NULL DEFAULT TRUE,
    -- JWKS（private_key_jwt 用）
    jwks_uri         TEXT,
    jwks_json        TEXT,
    -- 聯絡資訊
    contacts         TEXT[]             NOT NULL DEFAULT '{}',
    -- 稽核
    created_by       UUID               NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

-- ─── OAuth2 授權碼 ────────────────────────────────────────────
CREATE TABLE oauth_authorization_codes (
    id                UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    code              TEXT         NOT NULL UNIQUE,
    client_id         UUID         NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
    user_id           UUID         NOT NULL REFERENCES users(id),
    redirect_uri      TEXT         NOT NULL,
    scopes            TEXT[]       NOT NULL DEFAULT '{}',
    -- PKCE
    code_challenge        TEXT,
    code_challenge_method VARCHAR(10),                     -- S256 | plain
    -- 狀態
    used              BOOLEAN      NOT NULL DEFAULT FALSE,
    expires_at        TIMESTAMPTZ  NOT NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- 額外 claims
    nonce             TEXT,
    state             TEXT,
    auth_time         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Token 主表 ───────────────────────────────────────────────
CREATE TABLE oauth_tokens (
    id                UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    token_hash        TEXT         NOT NULL UNIQUE,   -- SHA-256(token)
    token_type        token_type   NOT NULL,
    client_id         UUID         NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
    user_id           UUID         REFERENCES users(id),  -- client_credentials 時為 null
    subscription_id   UUID         REFERENCES subscriptions(id),
    -- Token 內容（關鍵 Claims）
    scopes            TEXT[]       NOT NULL DEFAULT '{}',
    subject           VARCHAR(255) NOT NULL,              -- JWT sub
    audience          TEXT[]       NOT NULL DEFAULT '{}',
    -- 狀態
    expires_at        TIMESTAMPTZ  NOT NULL,
    revoked_at        TIMESTAMPTZ,
    revoke_reason     VARCHAR(100),
    -- 關聯
    parent_token_id   UUID         REFERENCES oauth_tokens(id),  -- refresh_token → access_token
    -- 追蹤
    issued_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_used_at      TIMESTAMPTZ,
    use_count         INT          NOT NULL DEFAULT 0,
    issuer            TEXT         NOT NULL DEFAULT 'https://auth.xcloudapim.local',
    -- 用戶端資訊
    ip_address        INET,
    user_agent        TEXT
);

-- ─── Scope 定義 ───────────────────────────────────────────────
CREATE TABLE oauth_scopes (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name         VARCHAR(100) NOT NULL UNIQUE,   -- e.g. api:read
    display_name VARCHAR(200) NOT NULL,
    description  TEXT,
    category     VARCHAR(50),                    -- api / profile / admin
    is_default   BOOLEAN      NOT NULL DEFAULT FALSE,
    requires_consent BOOLEAN  NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── 預設 Scope ───────────────────────────────────────────────
INSERT INTO oauth_scopes (name, display_name, description, category, is_default, requires_consent) VALUES
('openid',          'OpenID',           'OpenID Connect 身份識別',        'oidc',    TRUE,  FALSE),
('profile',         'Profile',          '存取使用者基本資料',              'profile', TRUE,  TRUE),
('email',           'Email',            '存取使用者電子郵件',              'profile', TRUE,  TRUE),
('offline_access',  'Offline Access',   '允許 Refresh Token 長期存取',    'auth',    FALSE, TRUE),
('api:read',        'API 讀取',         '呼叫 API 的唯讀存取權',          'api',     TRUE,  TRUE),
('api:write',       'API 寫入',         '呼叫 API 的寫入存取權',          'api',     FALSE, TRUE),
('api:admin',       'API 管理',         '管理 API 設定（限管理員）',       'api',     FALSE, TRUE),
('portal:access',   'Portal 存取',      '使用開發者 Portal',              'portal',  TRUE,  FALSE);

-- ─── Device Code Flow ─────────────────────────────────────────
CREATE TABLE oauth_device_codes (
    id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_code      TEXT         NOT NULL UNIQUE,
    user_code        CHAR(8)      NOT NULL UNIQUE,  -- 用戶輸入碼
    client_id        UUID         NOT NULL REFERENCES oauth_clients(id),
    scopes           TEXT[]       NOT NULL DEFAULT '{}',
    verification_uri TEXT         NOT NULL DEFAULT 'https://xcloudapim.local/device',
    -- 狀態
    approved         BOOLEAN,                       -- null=pending, true=approved, false=denied
    approved_by      UUID         REFERENCES users(id),
    expires_at       TIMESTAMPTZ  NOT NULL,
    poll_interval    INT          NOT NULL DEFAULT 5,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Client Credentials 快取（Gateway 使用） ─────────────────
CREATE TABLE client_credential_cache (
    client_id        VARCHAR(100) PRIMARY KEY,
    client_name      VARCHAR(200) NOT NULL,
    plan             plan_type    NOT NULL DEFAULT 'free',
    scopes           TEXT[]       NOT NULL DEFAULT '{}',
    active           BOOLEAN      NOT NULL DEFAULT TRUE,
    rpm_limit        BIGINT       NOT NULL DEFAULT 100,
    rpd_limit        BIGINT       NOT NULL DEFAULT 10000,
    -- 快取有效期
    cached_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW() + INTERVAL '5 minutes'
);

-- ─── Indexes ─────────────────────────────────────────────────
CREATE INDEX idx_oauth_clients_org     ON oauth_clients(organization_id);
CREATE INDEX idx_oauth_clients_active  ON oauth_clients(client_id) WHERE active = TRUE;
CREATE INDEX idx_auth_codes_code       ON oauth_authorization_codes(code) WHERE used = FALSE;
CREATE INDEX idx_auth_codes_expires    ON oauth_authorization_codes(expires_at) WHERE used = FALSE;
CREATE INDEX idx_tokens_hash           ON oauth_tokens(token_hash);
CREATE INDEX idx_tokens_client         ON oauth_tokens(client_id);
CREATE INDEX idx_tokens_user           ON oauth_tokens(user_id)    WHERE user_id IS NOT NULL;
CREATE INDEX idx_tokens_expires        ON oauth_tokens(expires_at) WHERE revoked_at IS NULL;
CREATE INDEX idx_device_codes_user     ON oauth_device_codes(user_code);
CREATE INDEX idx_device_codes_expires  ON oauth_device_codes(expires_at);

-- ─── 清除過期 Token 的 Stored Procedure ─────────────────────
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS INT AS $$
DECLARE
    deleted_count INT;
BEGIN
    DELETE FROM oauth_tokens
    WHERE expires_at < NOW() - INTERVAL '1 day'
       OR revoked_at < NOW() - INTERVAL '7 days';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    DELETE FROM oauth_authorization_codes
    WHERE expires_at < NOW()
       OR used = TRUE AND created_at < NOW() - INTERVAL '1 hour';

    DELETE FROM oauth_device_codes
    WHERE expires_at < NOW();

    DELETE FROM user_sessions
    WHERE expires_at < NOW();

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ─── Triggers ────────────────────────────────────────────────
CREATE TRIGGER trg_oauth_clients_updated_at
    BEFORE UPDATE ON oauth_clients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── View: 有效 Token 摘要（供 Gateway 查詢） ────────────────
CREATE VIEW active_tokens AS
SELECT
    t.token_hash,
    t.token_type,
    c.client_id,
    c.client_name,
    t.user_id,
    t.scopes,
    t.subject,
    s.plan_id,
    p.name          AS plan_name,
    p.rpm_limit,
    p.rpd_limit,
    t.expires_at,
    t.issued_at
FROM oauth_tokens t
JOIN oauth_clients c  ON c.id = t.client_id
LEFT JOIN subscriptions s ON s.id = t.subscription_id AND s.status = 'active'
LEFT JOIN plans p         ON p.id = s.plan_id
WHERE t.revoked_at  IS NULL
  AND t.expires_at  > NOW()
  AND t.token_type  = 'access_token'
  AND c.active      = TRUE;
