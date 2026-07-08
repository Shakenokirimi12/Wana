// Data Plane migrations for Durable Objects SQLite
// Drizzle durable-sqlite migrator resolves SQL by journal entry idx:
//   migrations[`m` + String(idx).padStart(4, "0")]  →  m0000, m0001, …
// The `tag` is only used in error messages.

export default {
  journal: {
    version: "7",
    dialect: "sqlite",
    entries: [
      {
        idx: 0,
        version: "5",
        when: 1714665600000,
        tag: "0001_initial",
        breakpoints: true,
      },
      {
        idx: 1,
        version: "5",
        when: 1746211200000,
        tag: "0002_issue_culprit",
        breakpoints: true,
      },
      {
        idx: 2,
        version: "5",
        when: 1749000000000,
        tag: "0003_event_tags",
        breakpoints: true,
      },
      {
        idx: 3,
        version: "5",
        when: 1781420000000,
        tag: "0004_issue_assignee",
        breakpoints: true,
      },
      {
        idx: 4,
        version: "5",
        when: 1781430000000,
        tag: "0005_issue_comments_activity",
        breakpoints: true,
      },
      {
        idx: 5,
        version: "5",
        when: 1781450000000,
        tag: "0006_debug_files",
        breakpoints: true,
      },
      {
        idx: 6,
        version: "5",
        when: 1781460000000,
        tag: "0007_debug_files_git_context",
        breakpoints: true,
      },
    ],
  },
  migrations: {
    m0000: `
      CREATE TABLE IF NOT EXISTS issues (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        type TEXT NOT NULL,
        value TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unresolved',
        events_count INTEGER NOT NULL DEFAULT 0,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_issues_fingerprint ON issues(fingerprint);
      CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
      CREATE INDEX IF NOT EXISTS idx_issues_last_seen ON issues(last_seen);
      
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id),
        timestamp INTEGER NOT NULL,
        environment TEXT,
        release TEXT,
        r2_payload_key TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_events_issue_id ON events(issue_id);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
    `,
    m0001: `
      ALTER TABLE issues ADD COLUMN culprit TEXT;
    `,
    m0002: `
      ALTER TABLE events ADD COLUMN tags_json TEXT;

      CREATE TABLE IF NOT EXISTS event_tags (
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (event_id, key)
      );

      CREATE INDEX IF NOT EXISTS idx_event_tags_kv ON event_tags(key, value);
      CREATE INDEX IF NOT EXISTS idx_event_tags_event ON event_tags(event_id);
    `,
    m0003: `
      ALTER TABLE issues ADD COLUMN assignee_user_id TEXT;

      CREATE INDEX IF NOT EXISTS idx_issues_assignee ON issues(assignee_user_id);
    `,
    m0004: `
      CREATE TABLE IF NOT EXISTS issue_comments (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL,
        author_user_id TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_issue_comments_issue
        ON issue_comments(issue_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS issue_activity (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL,
        actor_user_id TEXT,
        kind TEXT NOT NULL,
        payload_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_issue_activity_issue
        ON issue_activity(issue_id, created_at DESC);
    `,
    m0005: `
      CREATE TABLE IF NOT EXISTS debug_files (
        id TEXT PRIMARY KEY,
        uuid TEXT NOT NULL,
        arch TEXT,
        original_filename TEXT NOT NULL,
        r2_key TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        uploaded_at INTEGER NOT NULL,
        uploaded_by_user_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_debug_files_uuid ON debug_files(uuid);
    `,
    m0006: `
      ALTER TABLE debug_files ADD COLUMN git_sha TEXT;
      ALTER TABLE debug_files ADD COLUMN git_repo TEXT;
    `,
  },
};
