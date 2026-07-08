-- Numeric DSN-compatible project id. Apply on prod with
--   pnpm exec wrangler d1 execute wana-control-plane --remote \
--     --file=packages/schema/migrations/0004_project_external_id.sql
-- (the remote D1 has no d1_migrations tracking row — see deploy notes).
--
-- @sentry/core's validateDsn() rejects any DSN whose trailing path segment
-- (the "projectId") isn't entirely digits, unless the consumer's bundler
-- defines `__SENTRY_DEBUG__: false` at build time. Wana project ids are
-- free-form slugs (e.g. "gakusai-assistant"), so embedding `projects.id`
-- directly in the DSN silently breaks Sentry SDK delivery for most
-- consumers. `external_id` is a random numeric surrogate used only in the
-- DSN / ingest URL — `projects.id` remains the human-readable identifier
-- everywhere else.

ALTER TABLE projects ADD COLUMN external_id INTEGER;

UPDATE projects
SET external_id = (ABS(RANDOM()) % 900000000) + 100000000
WHERE external_id IS NULL;

CREATE UNIQUE INDEX idx_projects_external_id ON projects(external_id);
