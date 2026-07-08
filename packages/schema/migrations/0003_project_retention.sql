-- Project-level retention + monthly quota. Apply on prod with
--   pnpm exec wrangler d1 execute wana-control-plane --remote \
--     --file=packages/schema/migrations/0003_project_retention.sql
-- (the remote D1 has no d1_migrations tracking row — see deploy notes).

ALTER TABLE projects
  ADD COLUMN retention_days INTEGER NOT NULL DEFAULT 30;

ALTER TABLE projects
  ADD COLUMN max_events_per_month INTEGER;
