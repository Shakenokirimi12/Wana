-- Organization-level feature flags. Owners of an organization don't toggle
-- these directly; operators flip them when a customer crosses the relevant
-- billing threshold. Start with a single boolean for the email-notification
-- channel; promote to a `plan` column + `features_json` if/when more flags
-- accumulate.

ALTER TABLE organizations
  ADD COLUMN features_email_notifications INTEGER NOT NULL DEFAULT 0;
