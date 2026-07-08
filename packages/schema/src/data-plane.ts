import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";

// Data Plane Schema (Durable Objects SQLite)
// Each project has its own DO instance with isolated SQLite database

export const issues = sqliteTable(
  "issues",
  {
    id: text("id").primaryKey(),
    fingerprint: text("fingerprint").notNull(),
    type: text("type").notNull(),
    value: text("value").notNull(),
    status: text("status", { enum: ["unresolved", "resolved", "ignored"] })
      .notNull()
      .default("unresolved"),
    eventsCount: integer("events_count").notNull().default(0),
    /** Top stack frame location (e.g. app/components/Foo.tsx), Sentry-style. */
    culprit: text("culprit"),
    firstSeen: integer("first_seen", { mode: "timestamp_ms" }).notNull(),
    lastSeen: integer("last_seen", { mode: "timestamp_ms" }).notNull(),
    /** Control-plane user id of the assignee, or null when nobody is assigned. */
    assigneeUserId: text("assignee_user_id"),
  },
  (table) => [
    index("idx_issues_fingerprint").on(table.fingerprint),
    // Match the data-plane migration (idx_issues_status / idx_issues_last_seen)
    // so drizzle-kit generate won't show drift / propose dropping them.
    index("idx_issues_status").on(table.status),
    index("idx_issues_last_seen").on(table.lastSeen),
    index("idx_issues_assignee").on(table.assigneeUserId),
  ]
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id),
    timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull(),
    environment: text("environment"),
    release: text("release"),
    r2PayloadKey: text("r2_payload_key").notNull(),
    /** Full flat tag map for issue-detail display (canonical JSON, sorted keys). */
    tagsJson: text("tags_json"),
  },
  (table) => [
    index("idx_events_issue_id").on(table.issueId),
    index("idx_events_timestamp").on(table.timestamp),
  ]
);

/**
 * Operator-authored comments on an issue (Sentry-style discussion thread).
 * Authors can edit/delete only their own comments — enforced at the route
 * layer, not by the DO.
 */
export const issueComments = sqliteTable(
  "issue_comments",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id").notNull(),
    authorUserId: text("author_user_id").notNull(),
    body: text("body").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("idx_issue_comments_issue").on(table.issueId, table.createdAt),
  ]
);

/**
 * Activity log — status changes, assigns, auto-regression, etc. The
 * dispatch path writes here so the issue-detail timeline can render
 * who/when/what without polling the audit table on every render.
 */
export const issueActivity = sqliteTable(
  "issue_activity",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id").notNull(),
    /** Null for system-driven events (e.g. auto-regression on new event). */
    actorUserId: text("actor_user_id"),
    /** "status_change" | "assign" | "comment" | "regression_auto" | ... */
    kind: text("kind").notNull(),
    /** Free-form JSON detail per kind (old/new status, assignee, etc.). */
    payloadJson: text("payload_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("idx_issue_activity_issue").on(table.issueId, table.createdAt),
  ]
);

/**
 * Native debug-symbol files. The dSYM bytes live in R2 under `r2Key`;
 * this table is just the per-project index by Mach-O `uuid`. Worker
 * symbolicator container reads the R2 payload at symbolicate time.
 */
export const debugFiles = sqliteTable(
  "debug_files",
  {
    id: text("id").primaryKey(),
    /** Mach-O image UUID, canonical 32-hex lowercase. */
    uuid: text("uuid").notNull(),
    /** arm64 / x86_64 / armv7 / … — informational. */
    arch: text("arch"),
    originalFilename: text("original_filename").notNull(),
    /** Key in PAYLOAD_STORAGE: `debug-files/<projectId>/<uuid>/<filename>`. */
    r2Key: text("r2_key").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedAt: integer("uploaded_at", { mode: "timestamp_ms" }).notNull(),
    uploadedByUserId: text("uploaded_by_user_id"),
    /**
     * Source-code context captured at upload time. Used to deep-link
     * symbolicated frames to GitHub (`<repo>/blob/<sha>/<file>#L<line>`).
     * Both nullable: the CLI only sets them when run inside a git
     * checkout with a recognized remote.
     */
    gitSha: text("git_sha"),
    gitRepo: text("git_repo"),
  },
  (table) => [index("idx_debug_files_uuid").on(table.uuid)]
);

/**
 * Normalized per-event tag rows for indexed search. Insert alongside the event
 * row. `ON DELETE CASCADE` keeps retention purges of `events` tidy.
 */
export const eventTags = sqliteTable(
  "event_tags",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.key] }),
    index("idx_event_tags_kv").on(table.key, table.value),
    index("idx_event_tags_event").on(table.eventId),
  ]
);
