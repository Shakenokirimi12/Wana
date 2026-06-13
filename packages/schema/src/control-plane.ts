import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// Control Plane Schema (Cloudflare D1)
// Stores cross-cutting configuration data with low update frequency

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").unique().notNull(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  username: text("username").unique(),
  emailVerifiedAt: integer("email_verified_at", { mode: "timestamp_ms" }),
});

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  slug: text("slug").unique().notNull(),
  name: text("name").notNull(),
});

export const organizationMembers = sqliteTable("organization_members", {
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  role: text("role", { enum: ["owner", "admin", "member"] }).notNull(),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  doId: text("do_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    keyHash: text("key_hash").notNull(),
    hint: text("hint").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("idx_api_keys_hash_project").on(t.keyHash, t.projectId)]
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  userAgent: text("user_agent"),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
});

export const webauthnCredentials = sqliteTable(
  "webauthn_credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    credentialId: text("credential_id").unique().notNull(),
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull().default(0),
    transports: text("transports"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("idx_webauthn_credentials_user").on(t.userId)]
);

export const organizationSlugRedirects = sqliteTable(
  "organization_slug_redirects",
  {
    oldSlug: text("old_slug").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  }
);

export const userUsernameRedirects = sqliteTable(
  "user_username_redirects",
  {
    oldUsername: text("old_username").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  }
);

export const organizationInvites = sqliteTable(
  "organization_invites",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    tokenHash: text("token_hash").unique().notNull(),
    role: text("role", { enum: ["admin", "member"] }).notNull(),
    invitedEmail: text("invited_email"),
    invitedUsername: text("invited_username"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    maxUses: integer("max_uses").notNull().default(1),
    useCount: integer("use_count").notNull().default(0),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("idx_organization_invites_org").on(t.orgId)]
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => users.id),
    orgId: text("org_id").references(() => organizations.id),
    projectId: text("project_id").references(() => projects.id),
    action: text("action").notNull(),
    payloadJson: text("payload_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("idx_audit_events_project").on(t.projectId),
    index("idx_audit_events_org").on(t.orgId),
  ]
);

// ─── Notifications (P1: webhook only) ───────────────────────────────────────

export const notificationEndpoints = sqliteTable(
  "notification_endpoints",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("webhook"),
    target: text("target").notNull(),
    secretEnc: text("secret_enc").notNull(),
    secretNonce: text("secret_nonce").notNull(),
    secretHint: text("secret_hint").notNull(),
    kekVersion: integer("kek_version").notNull().default(1),
    configJson: text("config_json"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    createdByUserId: text("created_by_user_id"),
  },
  (t) => [index("idx_notif_ep_project").on(t.projectId)]
);

export const notificationRules = sqliteTable(
  "notification_rules",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => notificationEndpoints.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    onIssueCreated: integer("on_issue_created", { mode: "boolean" })
      .notNull()
      .default(false),
    onIssueResolved: integer("on_issue_resolved", { mode: "boolean" })
      .notNull()
      .default(false),
    onIssueRegressed: integer("on_issue_regressed", { mode: "boolean" })
      .notNull()
      .default(false),
    onSpike: integer("on_spike", { mode: "boolean" }).notNull().default(false),
    filterQuery: text("filter_query"),
    minIntervalSeconds: integer("min_interval_seconds").notNull().default(60),
    lastFiredAt: integer("last_fired_at", { mode: "timestamp_ms" }),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    createdByUserId: text("created_by_user_id"),
  },
  (t) => [
    index("idx_notif_rule_project").on(t.projectId),
    index("idx_notif_rule_endpoint").on(t.endpointId),
    index("idx_notif_rule_project_active").on(t.projectId, t.isActive),
  ]
);

// SET NULL on rule/endpoint delete so the audit history survives.
export const notificationDeliveries = sqliteTable(
  "notification_deliveries",
  {
    id: text("id").primaryKey(),
    ruleId: text("rule_id").references(() => notificationRules.id, {
      onDelete: "set null",
    }),
    endpointId: text("endpoint_id").references(
      () => notificationEndpoints.id,
      { onDelete: "set null" }
    ),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    issueId: text("issue_id"),
    eventKind: text("event_kind").notNull(),
    status: text("status").notNull(),
    attempt: integer("attempt").notNull().default(1),
    responseStatus: integer("response_status"),
    responseMs: integer("response_ms"),
    errorMessage: text("error_message"),
    payloadPreview: text("payload_preview"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("idx_notif_del_project_created").on(t.projectId, t.createdAt)]
);
