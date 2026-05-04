-- ═══════════════════════════════════════════════════════════════
--  V3: Policy 管理系統
-- ═══════════════════════════════════════════════════════════════

-- ─── ENUM ────────────────────────────────────────────────────
CREATE TYPE policy_type AS ENUM (
    'jwt_auth',
    'api_key_auth',
    'oauth2_scope',
    'rate_limit',
    'cors',
    'request_transform',
    'response_transform',
    'ip_whitelist',
    'ip_blacklist',
    'cache',
    'encrypt',
    'circuit_breaker',
    'retry',
    'timeout',
    'logging',
    'custom'
);

CREATE TYPE policy_phase AS ENUM (
    'pre_request',
    'post_request',
    'pre_response',
    'post_response'
);

CREATE TYPE policy_chain_status AS ENUM ('draft', 'published', 'archived');

-- ─── Policy Chain（一組有序的 Policies） ─────────────────────
CREATE TABLE policy_chains (
    id              UUID                 PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID                 NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    api_id          UUID                 REFERENCES apis(id) ON DELETE SET NULL,  -- null = 全域 Chain
    name            VARCHAR(100)         NOT NULL,
    description     TEXT,
    status          policy_chain_status  NOT NULL DEFAULT 'draft',
    version         INT                  NOT NULL DEFAULT 1,
    -- React Flow 畫布狀態
    canvas_json     JSONB,               -- 完整 React Flow nodes/edges JSON
    -- 發佈資訊
    published_at    TIMESTAMPTZ,
    published_by    UUID                 REFERENCES users(id),
    -- 稽核
    created_by      UUID                 NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);

-- ─── Policy 定義（Chain 中的單一節點） ───────────────────────
CREATE TABLE policies (
    id             UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    chain_id       UUID         NOT NULL REFERENCES policy_chains(id) ON DELETE CASCADE,
    type           policy_type  NOT NULL,
    phase          policy_phase NOT NULL DEFAULT 'pre_request',
    exec_order     INT          NOT NULL DEFAULT 100,  -- 執行順序（小的先）
    name           VARCHAR(100) NOT NULL,
    description    TEXT,
    enabled        BOOLEAN      NOT NULL DEFAULT TRUE,
    -- 設定（各 type 有不同結構，用 JSONB 儲存）
    config         JSONB        NOT NULL DEFAULT '{}',
    -- 條件執行（可選，JSON 條件表達式）
    condition_expr TEXT,
    -- React Flow 節點位置
    position_x     FLOAT,
    position_y     FLOAT,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Policy Chain 版本歷史 ────────────────────────────────────
CREATE TABLE policy_chain_versions (
    id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    chain_id        UUID         NOT NULL REFERENCES policy_chains(id) ON DELETE CASCADE,
    version         INT          NOT NULL,
    -- 版本快照（整個 chain + policies 的 JSON）
    snapshot        JSONB        NOT NULL,
    change_summary  TEXT,
    created_by      UUID         NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE(chain_id, version)
);

-- ─── 內建 Policy 模板庫 ───────────────────────────────────────
CREATE TABLE policy_templates (
    id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    type            policy_type  NOT NULL,
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    -- JSON Schema 定義此 policy config 的結構（供 Studio UI 渲染表單）
    config_schema   JSONB        NOT NULL DEFAULT '{}',
    -- 預設設定值
    default_config  JSONB        NOT NULL DEFAULT '{}',
    -- UI 相關
    icon            VARCHAR(50),
    color           VARCHAR(20)  DEFAULT '#6366f1',
    tags            TEXT[]       NOT NULL DEFAULT '{}',
    -- 版本
    version         VARCHAR(20)  NOT NULL DEFAULT '1.0.0',
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── 補充 gateway_routes 的 FK ───────────────────────────────
ALTER TABLE gateway_routes
    ADD CONSTRAINT fk_gateway_routes_chain
    FOREIGN KEY (policy_chain_id) REFERENCES policy_chains(id) ON DELETE SET NULL;

-- ─── Policy Cache Invalidation Log ───────────────────────────
CREATE TABLE policy_cache_events (
    id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    chain_id    UUID         NOT NULL,
    api_id      UUID,
    event_type  VARCHAR(50)  NOT NULL,  -- published | invalidated | rollback
    metadata    JSONB        NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── 插入內建 Policy 模板 ────────────────────────────────────
INSERT INTO policy_templates (type, name, description, config_schema, default_config, icon, color, tags) VALUES

('jwt_auth', 'JWT 驗證', '驗證 Bearer Token（RS256/HS256）',
 '{"type":"object","required":["algorithm"],"properties":{"algorithm":{"type":"string","enum":["RS256","HS256","ES256"]},"jwks_url":{"type":"string","format":"uri"},"issuer":{"type":"string"},"audience":{"type":"string"},"required_scopes":{"type":"array","items":{"type":"string"}},"cache_seconds":{"type":"integer","minimum":0,"maximum":3600}}}',
 '{"algorithm":"RS256","cache_seconds":300}',
 'shield', '#6366f1', ARRAY['auth','security']),

('rate_limit', '速率限制', '使用 Redis Sliding Window 限制 API 呼叫頻率',
 '{"type":"object","required":["key_by","rpm"],"properties":{"strategy":{"type":"string","enum":["fixed_window","sliding_window","token_bucket"]},"key_by":{"type":"string","enum":["client_id","ip","user_id"]},"rpm":{"type":"integer","minimum":1},"rpd":{"type":"integer","minimum":1},"burst_multiplier":{"type":"number","minimum":1,"maximum":10}}}',
 '{"strategy":"sliding_window","key_by":"client_id","rpm":1000,"burst_multiplier":1.5}',
 'gauge', '#f59e0b', ARRAY['rate-limit','traffic']),

('cors', 'CORS 設定', '處理跨來源資源共享標頭',
 '{"type":"object","required":["allowed_origins"],"properties":{"allowed_origins":{"type":"array","items":{"type":"string"}},"allowed_methods":{"type":"array","items":{"type":"string","enum":["GET","POST","PUT","PATCH","DELETE","OPTIONS","HEAD"]}},"allowed_headers":{"type":"array","items":{"type":"string"}},"allow_credentials":{"type":"boolean"},"max_age":{"type":"integer","minimum":0}}}',
 '{"allowed_origins":["*"],"allowed_methods":["GET","POST","PUT","DELETE","OPTIONS"],"allowed_headers":["Content-Type","Authorization"],"allow_credentials":false,"max_age":3600}',
 'globe', '#10b981', ARRAY['security','cors']),

('request_transform', 'Request 轉換', '修改請求 Header、Body 與 URL',
 '{"type":"object","properties":{"request_headers":{"type":"array","items":{"type":"object","properties":{"action":{"type":"string","enum":["add","set","remove","rename"]},"name":{"type":"string"},"value":{"type":"string"}}}},"url_rewrite":{"type":"object","properties":{"from":{"type":"string"},"to":{"type":"string"}}}}}',
 '{"request_headers":[],"url_rewrite":null}',
 'shuffle', '#3b82f6', ARRAY['transform']),

('response_transform', 'Response 轉換', '修改回應 Header 與 Body',
 '{"type":"object","properties":{"response_headers":{"type":"array"},"response_body":{"type":"array"},"mask_fields":{"type":"array","items":{"type":"string"}}}}',
 '{"response_headers":[],"mask_fields":[]}',
 'shuffle', '#8b5cf6', ARRAY['transform']),

('ip_whitelist', 'IP 白名單', '僅允許指定 IP/CIDR 存取',
 '{"type":"object","required":["ips"],"properties":{"mode":{"type":"string","enum":["whitelist","blacklist"]},"ips":{"type":"array","items":{"type":"string"}}}}',
 '{"mode":"whitelist","ips":[]}',
 'ban', '#ef4444', ARRAY['security','network']),

('cache', '回應快取', '快取後端回應，減少上游呼叫',
 '{"type":"object","required":["ttl_seconds"],"properties":{"ttl_seconds":{"type":"integer","minimum":1},"key_by":{"type":"array","items":{"type":"string"}},"vary_headers":{"type":"array","items":{"type":"string"}}}}',
 '{"ttl_seconds":60,"key_by":["method","path"],"vary_headers":[]}',
 'database', '#06b6d4', ARRAY['performance','cache']),

('circuit_breaker', '熔斷器', '當上游錯誤率超過閾值時自動熔斷',
 '{"type":"object","required":["threshold","window_seconds"],"properties":{"threshold":{"type":"integer","minimum":1,"maximum":100},"window_seconds":{"type":"integer","minimum":10},"half_open_requests":{"type":"integer","minimum":1},"timeout_ms":{"type":"integer","minimum":100}}}',
 '{"threshold":50,"window_seconds":60,"half_open_requests":3,"timeout_ms":5000}',
 'zap', '#f97316', ARRAY['resilience','traffic']),

('encrypt', '欄位加密', '對請求/回應中的敏感欄位進行加密遮罩',
 '{"type":"object","required":["fields","key_ref"],"properties":{"algorithm":{"type":"string","enum":["AES-256-GCM","RSA-OAEP"]},"fields":{"type":"array","items":{"type":"string"}},"key_ref":{"type":"string"}}}',
 '{"algorithm":"AES-256-GCM","fields":[],"key_ref":"transit/keys/field-encryption"}',
 'lock', '#ec4899', ARRAY['security','encryption']),

('logging', '請求記錄', '記錄請求/回應詳情至稽核日誌',
 '{"type":"object","properties":{"level":{"type":"string","enum":["debug","info","warn","error"]},"include_headers":{"type":"array","items":{"type":"string"}},"include_body":{"type":"boolean"},"mask_fields":{"type":"array","items":{"type":"string"}}}}',
 '{"level":"info","include_headers":["content-type","x-request-id"],"include_body":false,"mask_fields":["password","token","secret"]}',
 'file-text', '#64748b', ARRAY['observability','logging']);

-- ─── Indexes ─────────────────────────────────────────────────
CREATE INDEX idx_chains_api    ON policy_chains(api_id)    WHERE api_id IS NOT NULL;
CREATE INDEX idx_chains_org    ON policy_chains(organization_id);
CREATE INDEX idx_chains_status ON policy_chains(status);
CREATE INDEX idx_policies_chain  ON policies(chain_id, exec_order);
CREATE INDEX idx_policies_phase  ON policies(phase) WHERE enabled = TRUE;
CREATE INDEX idx_templates_type  ON policy_templates(type) WHERE is_active = TRUE;

-- ─── Triggers ────────────────────────────────────────────────
CREATE TRIGGER trg_chains_updated_at
    BEFORE UPDATE ON policy_chains
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_policies_updated_at
    BEFORE UPDATE ON policies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
