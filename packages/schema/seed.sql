-- Seed data for local development
-- Test DSN Key: wana_test_key_abc123
-- Hash: ed27438c10f665d539dbf799083c1ecafe536c8baa0b341759a9dc198f7fa7c8
--   (= SHA-256 hex of the key above; must match hashHex() in @wana/core used by ingest auth)
--
-- projects.do_id: either 64-hex from newUniqueId().toString() (dashboard "New project"), or a stable
-- idFromName key (e.g. wana:proj_01) for seeds — arbitrary hex is not valid in the DO namespace.

-- Reset projects (and keys) only; keep org / user for convenience.
DELETE FROM api_keys;
DELETE FROM projects;

INSERT OR REPLACE INTO users (id, email, name, created_at, username, email_verified_at)
VALUES ('user_01', 'dev@example.com', 'Developer', 1714665600000, 'developer', 1714665600000);

INSERT OR REPLACE INTO organizations (id, slug, name)
VALUES ('org_01', 'test-org', 'Test Organization');

INSERT OR REPLACE INTO organization_members (id, org_id, user_id, role)
VALUES ('member_01', 'org_01', 'user_01', 'owner');

INSERT INTO projects (id, org_id, name, do_id, created_at)
VALUES (
  'proj_01',
  'org_01',
  'Wana test project',
  'wana:proj_01',
  1714665600000
);

INSERT INTO api_keys (id, project_id, key_hash, hint, is_active, created_at)
VALUES (
  'key_01',
  'proj_01',
  'ed27438c10f665d539dbf799083c1ecafe536c8baa0b341759a9dc198f7fa7c8',
  'wana_test_...c123',
  1,
  1714665600000
);
