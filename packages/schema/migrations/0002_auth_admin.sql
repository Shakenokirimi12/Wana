-- Sessions (D1), WebAuthn credentials, username / email verification, redirects, invites, audit

ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN email_verified_at INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  user_agent TEXT,
  last_seen_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON webauthn_credentials(user_id);

CREATE TABLE IF NOT EXISTS organization_slug_redirects (
  old_slug TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_username_redirects (
  old_username TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_invites (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  invited_email TEXT,
  invited_username TEXT,
  expires_at INTEGER NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_organization_invites_org ON organization_invites(org_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id),
  org_id TEXT REFERENCES organizations(id),
  project_id TEXT REFERENCES projects(id),
  action TEXT NOT NULL,
  payload_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_project ON audit_events(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_org ON audit_events(org_id);
