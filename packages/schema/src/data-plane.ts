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
  },
  (table) => [
    index("idx_issues_fingerprint").on(table.fingerprint),
    // Match the data-plane migration (idx_issues_status / idx_issues_last_seen)
    // so drizzle-kit generate won't show drift / propose dropping them.
    index("idx_issues_status").on(table.status),
    index("idx_issues_last_seen").on(table.lastSeen),
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
