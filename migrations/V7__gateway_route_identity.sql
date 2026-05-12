-- ═══════════════════════════════════════════════════════════════
--  V7: Gateway route identity must preserve versions and methods
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE gateway_routes
    ADD COLUMN IF NOT EXISTS route_host_key TEXT NOT NULL DEFAULT '*',
    ADD COLUMN IF NOT EXISTS route_methods_key TEXT NOT NULL DEFAULT '*';

UPDATE gateway_routes
SET
    route_host_key = COALESCE(NULLIF(LOWER(TRIM(host_match)), ''), '*'),
    route_methods_key = COALESCE(NULLIF(array_to_string(methods, ','), ''), '*');

WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY api_id, route_host_key, path_prefix, route_methods_key, api_version_id
            ORDER BY updated_at DESC, id DESC
        ) AS row_num
    FROM gateway_routes
)
DELETE FROM gateway_routes gr
USING ranked r
WHERE gr.id = r.id
  AND r.row_num > 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_gateway_routes_identity
    ON gateway_routes(api_id, route_host_key, path_prefix, route_methods_key, api_version_id);
