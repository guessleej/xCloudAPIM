-- xCloudAPIM local development seed data.
-- Safe to re-run after migrations; values are deterministic so docs/tests can rely on them.

BEGIN;

INSERT INTO users (
  id,
  email,
  password_hash,
  display_name,
  status,
  email_verified,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  'codex-dev@apim.local',
  '$2a$10$Qc.nL2Lj7nbv6keSrFV.QuMwTLHAk9kZ780s0p/sEIls9hXFeUpMW',
  'Codex Dev',
  'active',
  TRUE,
  NOW(),
  NOW()
) ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  display_name = EXCLUDED.display_name,
  status = EXCLUDED.status,
  email_verified = EXCLUDED.email_verified,
  updated_at = NOW();

INSERT INTO organizations (
  id,
  name,
  slug,
  description,
  plan_type,
  max_members,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000002',
  'Codex Seed Org',
  'codex-seed-org',
  'Local development organization for smoke tests.',
  'enterprise',
  50,
  NOW(),
  NOW()
) ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  plan_type = EXCLUDED.plan_type,
  max_members = EXCLUDED.max_members,
  updated_at = NOW();

INSERT INTO organization_members (
  organization_id,
  user_id,
  role,
  joined_at
) VALUES (
  '00000000-0000-4000-8000-000000000002',
  (SELECT id FROM users WHERE email = 'codex-dev@apim.local'),
  'admin',
  NOW()
) ON CONFLICT (organization_id, user_id) DO UPDATE SET
  role = EXCLUDED.role;

INSERT INTO apis (
  id,
  organization_id,
  name,
  slug,
  description,
  category,
  tags,
  status,
  is_public,
  owner_id,
  documentation_url,
  metadata,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000002',
  'Echo API',
  'echo-api',
  'Local seed API for smoke tests and route sync checks.',
  'test',
  ARRAY['seed', 'smoke'],
  'published',
  TRUE,
  (SELECT id FROM users WHERE email = 'codex-dev@apim.local'),
  'http://localhost:18090/dev/echo/v1/docs',
  '{"seed": true}',
  NOW(),
  NOW()
) ON CONFLICT (organization_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  tags = EXCLUDED.tags,
  status = EXCLUDED.status,
  is_public = EXCLUDED.is_public,
  owner_id = EXCLUDED.owner_id,
  documentation_url = EXCLUDED.documentation_url,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();

INSERT INTO api_versions (
  id,
  api_id,
  version,
  status,
  spec_format,
  spec_content,
  spec_version,
  backend_protocol,
  upstream_url,
  strip_prefix,
  base_path,
  timeout_ms,
  retry_count,
  retry_delay_ms,
  changelog,
  published_at,
  created_by,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000003',
  '1.0.0',
  'active',
  'json',
  '{"openapi":"3.0.3","info":{"title":"Echo API","version":"1.0.0"},"paths":{"/anything":{"get":{"responses":{"200":{"description":"OK"}}}}}}',
  '3.0.3',
  'https',
  'https://httpbin.org',
  '/dev/echo/v1',
  '/dev/echo/v1',
  5000,
  0,
  500,
  'Initial local seed version.',
  NOW(),
  (SELECT id FROM users WHERE email = 'codex-dev@apim.local'),
  NOW(),
  NOW()
) ON CONFLICT (api_id, version) DO UPDATE SET
  status = EXCLUDED.status,
  spec_format = EXCLUDED.spec_format,
  spec_content = EXCLUDED.spec_content,
  spec_version = EXCLUDED.spec_version,
  backend_protocol = EXCLUDED.backend_protocol,
  upstream_url = EXCLUDED.upstream_url,
  strip_prefix = EXCLUDED.strip_prefix,
  base_path = EXCLUDED.base_path,
  timeout_ms = EXCLUDED.timeout_ms,
  retry_count = EXCLUDED.retry_count,
  retry_delay_ms = EXCLUDED.retry_delay_ms,
  changelog = EXCLUDED.changelog,
  published_at = COALESCE(api_versions.published_at, EXCLUDED.published_at),
  updated_at = NOW();

INSERT INTO api_endpoints (
  id,
  api_version_id,
  path,
  method,
  summary,
  description,
  tags,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000005',
  '00000000-0000-4000-8000-000000000004',
  '/anything',
  'GET',
  'Echo request data',
  'Seed endpoint for smoke testing.',
  ARRAY['seed'],
  NOW(),
  NOW()
) ON CONFLICT (api_version_id, path, method) DO UPDATE SET
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  tags = EXCLUDED.tags,
  updated_at = NOW();

INSERT INTO gateway_routes (
  id,
  api_id,
  api_version_id,
  host_match,
  path_prefix,
  methods,
  upstream_url,
  strip_prefix,
  active,
  priority,
  metadata,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000006',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
  NULL,
  '/dev/echo/v1',
  ARRAY['GET']::endpoint_method[],
  'https://httpbin.org',
  '/dev/echo/v1',
  TRUE,
  10,
  '{"seed": true}',
  NOW(),
  NOW()
) ON CONFLICT (api_id, route_host_key, path_prefix, route_methods_key, api_version_id) DO UPDATE SET
  upstream_url = EXCLUDED.upstream_url,
  strip_prefix = EXCLUDED.strip_prefix,
  active = EXCLUDED.active,
  priority = EXCLUDED.priority,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();

INSERT INTO subscriptions (
  id,
  organization_id,
  api_id,
  plan_id,
  subscriber_id,
  status,
  start_date,
  approved_by,
  approved_at,
  notes,
  metadata,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000007',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  (SELECT id FROM plans WHERE name = 'enterprise'),
  (SELECT id FROM users WHERE email = 'codex-dev@apim.local'),
  'active',
  CURRENT_DATE,
  (SELECT id FROM users WHERE email = 'codex-dev@apim.local'),
  NOW(),
  'Local development subscription.',
  '{"seed": true}',
  NOW(),
  NOW()
) ON CONFLICT (organization_id, api_id) DO UPDATE SET
  plan_id = EXCLUDED.plan_id,
  subscriber_id = EXCLUDED.subscriber_id,
  status = EXCLUDED.status,
  approved_by = EXCLUDED.approved_by,
  approved_at = COALESCE(subscriptions.approved_at, EXCLUDED.approved_at),
  notes = EXCLUDED.notes,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();

INSERT INTO api_keys (
  id,
  subscription_id,
  organization_id,
  key_hash,
  key_prefix,
  name,
  description,
  status,
  scopes,
  created_by,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000008',
  '00000000-0000-4000-8000-000000000007',
  '00000000-0000-4000-8000-000000000002',
  'd0d40c8dd01c362a555e683eb381ae555477f0b19e16b3a9d78491bf6b206996',
  'xcapim_d',
  'Local Smoke Key',
  'Plaintext for local smoke tests: xcapim_dev_key_1234567890',
  'active',
  ARRAY['gateway:invoke'],
  (SELECT id FROM users WHERE email = 'codex-dev@apim.local'),
  NOW(),
  NOW()
) ON CONFLICT (key_hash) DO UPDATE SET
  subscription_id = EXCLUDED.subscription_id,
  organization_id = EXCLUDED.organization_id,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  status = EXCLUDED.status,
  scopes = EXCLUDED.scopes,
  updated_at = NOW();

COMMIT;
