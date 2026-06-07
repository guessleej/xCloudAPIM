-- ═══════════════════════════════════════════════════════════════
--  V9 — 不可變稽核日誌（Immutable Audit Log，P3）
--  append-only：觸發器禁止 UPDATE/DELETE/TRUNCATE
--  防竄改：每列含 row_hash = sha256(prev_hash || canonical_payload)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGSERIAL PRIMARY KEY,
    ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
    topic       TEXT        NOT NULL,
    event_type  TEXT,
    actor       TEXT,
    source_ip   TEXT,
    payload     JSONB       NOT NULL,
    prev_hash   TEXT        NOT NULL DEFAULT '',
    row_hash    TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_ts    ON audit_log (ts);
CREATE INDEX IF NOT EXISTS idx_audit_log_topic ON audit_log (topic);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log (actor);

-- ─── 不可變性：拒絕任何 UPDATE / DELETE / TRUNCATE ───────────────
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only (% is not permitted)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_no_modify ON audit_log;
CREATE TRIGGER trg_audit_log_no_modify
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

DROP TRIGGER IF EXISTS trg_audit_log_no_truncate ON audit_log;
CREATE TRIGGER trg_audit_log_no_truncate
    BEFORE TRUNCATE ON audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();

COMMENT ON TABLE audit_log IS 'Append-only, tamper-evident audit log (P3). Writes via audit-sink consumer; UPDATE/DELETE/TRUNCATE blocked by trigger.';
