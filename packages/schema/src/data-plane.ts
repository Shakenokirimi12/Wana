import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

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
  },
  (table) => [
    index("idx_events_issue_id").on(table.issueId),
    index("idx_events_timestamp").on(table.timestamp),
  ]
);
