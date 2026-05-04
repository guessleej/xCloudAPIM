-- ═══════════════════════════════════════════════════════════════
--  V2: API 版本管理系統
-- ═══════════════════════════════════════════════════════════════

-- ─── ENUM ────────────────────────────────────────────────────
CREATE TYPE api_status      AS ENUM ('draft', 'published', 'deprecated', 'archived');
CREATE TYPE api_version_status AS ENUM ('draft', 'active', 'deprecated', 'retired');
CREATE TYPE endpoint_method AS ENUM ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS');
CREATE TYPE backend_protocol AS ENUM ('http', 'https', 'grpc', 'ws', 'wss');

-- ─── API 主表 ─────────────────────────────────────────────────
CREATE TABLE apis (
    id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id  UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name             VARCHAR(100) NOT NULL,
    slug             VARCHAR(100) NOT NULL,         -- URL-friendly name
    description      TEXT,
    category         VARCHAR(50),                   -- billing / auth / data / etc.
    tags             TEXT[]       NOT NULL DEFAULT '{}',
    status           api_status   NOT NULL DEFAULT 'draft',
    is_public        BOOLEAN      NOT NULL DEFAULT FALSE,  -- 是否在 Portal 公開
    owner_id         UUID         NOT NULL REFERENCES users(id),
    thumbnail_url    TEXT,
    documentation_url TEXT,
    metadata         JSONB        NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at       TIMESTAMPTZ,
    UNIQUE(organization_id, slug)
);

-- ─── API 版本 ─────────────────────────────────────────────────
CREATE TABLE api_versions (
    id              UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_id          UUID              NOT NULL REFERENCES apis(id) ON DELETE CASCADE,
    version         VARCHAR(20)       NOT NULL,     -- semver e.g. 1.0.0
    status          api_version_status NOT NULL DEFAULT 'draft',
    -- OpenAPI Spec
    spec_format     VARCHAR(10)       NOT NULL DEFAULT 'yaml',  -- yaml | json
    spec_content    TEXT,                           -- OpenAPI 3.x 全文
    spec_version    VARCHAR(10)       NOT NULL DEFAULT '3.0.3',
    -- 後端設定
    backend_protocol backend_protocol NOT NULL DEFAULT 'https',
    upstream_url    VARCHAR(500)      NOT NULL,     -- e.g. https://api.backend.com
    strip_prefix    VARCHAR(200),                   -- 移除 path prefix
    base_path       VARCHAR(200)      NOT NULL DEFAULT '/',
    -- 流量設定
    timeout_ms      INT               NOT NULL DEFAULT 30000,
    retry_count     INT               NOT NULL DEFAULT 0,
    retry_delay_ms  INT               NOT NULL DEFAULT 500,
    -- 版本資訊
    changelog       TEXT,
    published_at    TIMESTAMPTZ,
    deprecated_at   TIMESTAMPTZ,
    sunset_date     DATE,
    created_by      UUID              NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
    UNIQUE(api_id, version)
);

-- ─── API Endpoint ─────────────────────────────────────────────
CREATE TABLE api_endpoints (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_version_id  UUID            NOT NULL REFERENCES api_versions(id) ON DELETE CASCADE,
    path            VARCHAR(500)    NOT NULL,   -- e.g. /users/{id}
    method          endpoint_method NOT NULL,
    summary         VARCHAR(200),
    description     TEXT,
    tags            TEXT[]          NOT NULL DEFAULT '{}',
    -- 覆寫設定（繼承自 api_version，可個別覆寫）
    upstream_path   VARCHAR(500),               -- 不同時為 null 才覆寫
    timeout_ms      INT,
    -- 文件
    request_schema  JSONB,                      -- JSON Schema
    response_schema JSONB,
    example_request TEXT,
    example_response TEXT,
    is_deprecated   BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE(api_version_id, path, method)
);

-- ─── API 標籤（多對多） ───────────────────────────────────────
CREATE TABLE api_tags (
    api_id  UUID        NOT NULL REFERENCES apis(id) ON DELETE CASCADE,
    tag     VARCHAR(50) NOT NULL,
    PRIMARY KEY(api_id, tag)
);

-- ─── Gateway 路由快照（供 Gateway 快速載入） ─────────────────
CREATE TABLE gateway_routes (
    id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_id          UUID         NOT NULL REFERENCES apis(id) ON DELETE CASCADE,
    api_version_id  UUID         NOT NULL REFERENCES api_versions(id) ON DELETE CASCADE,
    -- 匹配條件
    host_match      VARCHAR(255),                   -- 如為 null 則不限 host
    path_prefix     VARCHAR(200) NOT NULL,
    methods         endpoint_method[],              -- null = 所有 method
    -- 代理目標
    upstream_url    VARCHAR(500) NOT NULL,
    strip_prefix    VARCHAR(200),
    -- Policy Chain
    policy_chain_id UUID,                           -- FK 在 V3 migrations 建立
    -- 狀態
    active          BOOLEAN      NOT NULL DEFAULT TRUE,
    priority        INT          NOT NULL DEFAULT 100, -- 數字越小優先越高
    metadata        JSONB        NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Indexes ─────────────────────────────────────────────────
CREATE INDEX idx_apis_org        ON apis(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_apis_status     ON apis(status)          WHERE deleted_at IS NULL;
CREATE INDEX idx_apis_slug       ON apis(slug);
CREATE INDEX idx_apis_tags       ON apis USING GIN(tags);
CREATE INDEX idx_api_versions    ON api_versions(api_id, status);
CREATE INDEX idx_endpoints_ver   ON api_endpoints(api_version_id);
CREATE INDEX idx_routes_active   ON gateway_routes(active, priority) WHERE active = TRUE;
CREATE INDEX idx_routes_prefix   ON gateway_routes(path_prefix)     WHERE active = TRUE;

-- ─── Triggers ────────────────────────────────────────────────
CREATE TRIGGER trg_apis_updated_at
    BEFORE UPDATE ON apis
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_api_versions_updated_at
    BEFORE UPDATE ON api_versions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_endpoints_updated_at
    BEFORE UPDATE ON api_endpoints
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_gateway_routes_updated_at
    BEFORE UPDATE ON gateway_routes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
