import { and, asc, eq, or } from "drizzle-orm";
import {
  organizations,
  organizationMembers,
  projects,
  apiKeys,
  auditEvents,
} from "@wana/schema/control-plane";
import {
  apiKeyHint,
  generateNumericExternalId,
  generateSentryPublicKey,
  hashHex as hashDsnKey,
} from "@wana/core";
import { createDb } from "./db-client";
import { getOrgMembership, orgRoleAtLeast, type OrgRole } from "./org-service";
import { recordAuditEvent } from "./audit-service";
import type { Env } from "../../types/bindings";

/** Resolve a project's owning org id (for audit scoping), or null. */
async function getProjectOrgId(
  d1: D1Database,
  projectId: string
): Promise<string | null> {
  const db = createDb(d1);
  const rows = await db
    .select({ orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return rows[0]?.orgId ?? null;
}

const PROJECT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}[a-zA-Z0-9]$/;

export async function listProjectsWithOrg(d1: D1Database) {
  const db = createDb(d1);
  return db
    .select({
      id: projects.id,
      name: projects.name,
      orgSlug: organizations.slug,
      orgName: organizations.name,
      doId: projects.doId,
    })
    .from(projects)
    .innerJoin(organizations, eq(projects.orgId, organizations.id))
    .orderBy(asc(projects.name));
}

/**
 * Projects in the **active** organization (Slack-style team context).
 */
export async function listProjectsForDashboardUser(
  d1: D1Database,
  userId: string,
  activeOrgId: string | null
) {
  if (!activeOrgId) return [];

  const role = await getOrgMembership(d1, userId, activeOrgId);
  if (!role) return [];

  const db = createDb(d1);
  return db
    .select({
      id: projects.id,
      name: projects.name,
      orgSlug: organizations.slug,
      orgName: organizations.name,
      doId: projects.doId,
    })
    .from(projects)
    .innerJoin(organizations, eq(projects.orgId, organizations.id))
    .where(eq(projects.orgId, activeOrgId))
    .orderBy(asc(projects.name));
}

/** Organizations where the user may create projects (admin or owner). */
export async function listOrganizationsForProjectCreation(
  d1: D1Database,
  userId: string
) {
  const db = createDb(d1);
  return db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
    })
    .from(organizations)
    .innerJoin(
      organizationMembers,
      eq(organizations.id, organizationMembers.orgId)
    )
    .where(
      and(
        eq(organizationMembers.userId, userId),
        or(
          eq(organizationMembers.role, "owner"),
          eq(organizationMembers.role, "admin")
        )
      )
    )
    .orderBy(asc(organizations.name));
}

export async function userCanAccessProject(
  d1: D1Database,
  userId: string,
  projectId: string
): Promise<boolean> {
  const db = createDb(d1);
  const row = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(
      organizationMembers,
      eq(projects.orgId, organizationMembers.orgId)
    )
    .where(
      and(
        eq(projects.id, projectId),
        eq(organizationMembers.userId, userId)
      )
    )
    .limit(1);
  return row.length > 0;
}

/** The acting user's role in the project's org, or null if not a member. */
export async function getProjectRoleForUser(
  d1: D1Database,
  userId: string,
  projectId: string
): Promise<OrgRole | null> {
  const db = createDb(d1);
  const rows = await db
    .select({ role: organizationMembers.role })
    .from(projects)
    .innerJoin(
      organizationMembers,
      eq(projects.orgId, organizationMembers.orgId)
    )
    .where(
      and(eq(projects.id, projectId), eq(organizationMembers.userId, userId))
    )
    .limit(1);
  return (rows[0]?.role as OrgRole | undefined) ?? null;
}

export async function listApiKeysForProject(
  d1: D1Database,
  projectId: string,
  actingUserId: string
) {
  // Defense-in-depth: the function never returns key hashes, but still verify
  // the caller is a member of the project's org so it can't become an IDOR if a
  // future caller forgets the precondition.
  const role = await getProjectRoleForUser(d1, actingUserId, projectId);
  if (!role) {
    throw new Error("このプロジェクトの API キーを閲覧する権限がありません");
  }
  const db = createDb(d1);
  return db
    .select({
      id: apiKeys.id,
      hint: apiKeys.hint,
      isActive: apiKeys.isActive,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.projectId, projectId))
    .orderBy(asc(apiKeys.createdAt));
}

/** Issue an additional API key for a project (admin+). Returns the plain key once. */
export async function issueApiKeyForProject(
  d1: D1Database,
  projectId: string,
  actingUserId: string
): Promise<{ plainKey: string; hint: string }> {
  const role = await getProjectRoleForUser(d1, actingUserId, projectId);
  if (!role || !orgRoleAtLeast(role, "admin")) {
    throw new Error("APIキーの発行には admin 以上の権限が必要です");
  }
  const db = createDb(d1);
  const plainKey = generateSentryPublicKey();
  const keyHash = await hashDsnKey(plainKey);
  const hint = apiKeyHint(plainKey);
  await db.insert(apiKeys).values({
    id: crypto.randomUUID(),
    projectId,
    keyHash,
    hint,
    isActive: true,
    createdAt: new Date(),
  });
  await recordAuditEvent(d1, {
    actorUserId: actingUserId,
    orgId: await getProjectOrgId(d1, projectId),
    projectId,
    action: "apikey.issue",
    payload: { hint },
  });
  return { plainKey, hint };
}

/** Enable/disable (revoke) an API key (admin+). */
export async function setApiKeyActive(
  d1: D1Database,
  projectId: string,
  keyId: string,
  isActive: boolean,
  actingUserId: string
): Promise<void> {
  const role = await getProjectRoleForUser(d1, actingUserId, projectId);
  if (!role || !orgRoleAtLeast(role, "admin")) {
    throw new Error("APIキーの変更には admin 以上の権限が必要です");
  }
  const db = createDb(d1);
  await db
    .update(apiKeys)
    .set({ isActive })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.projectId, projectId)));
  await recordAuditEvent(d1, {
    actorUserId: actingUserId,
    orgId: await getProjectOrgId(d1, projectId),
    projectId,
    action: isActive ? "apikey.restore" : "apikey.revoke",
    payload: { keyId },
  });
}

/**
 * Deletes a project's control-plane rows (admin+). Returns the `doId` so the
 * caller can purge the Durable Object data + R2 payloads. Does NOT itself touch
 * the data plane.
 */
export async function deleteProject(
  d1: D1Database,
  projectId: string,
  actingUserId: string
): Promise<{ doId: string }> {
  const role = await getProjectRoleForUser(d1, actingUserId, projectId);
  if (!role || !orgRoleAtLeast(role, "admin")) {
    throw new Error("プロジェクトの削除には admin 以上の権限が必要です");
  }
  const db = createDb(d1);
  const rows = await db
    .select({ doId: projects.doId, orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (rows.length === 0) {
    throw new Error("プロジェクトが見つかりません");
  }
  await db.delete(apiKeys).where(eq(apiKeys.projectId, projectId));
  // Detach audit rows that reference this project (FK) — keep the history under
  // the org, with the project id preserved in their payload, but null the FK
  // column so the project row can be deleted.
  await db
    .update(auditEvents)
    .set({ projectId: null })
    .where(eq(auditEvents.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
  // projectId left null on the audit row: the project FK target is now gone.
  await recordAuditEvent(d1, {
    actorUserId: actingUserId,
    orgId: rows[0].orgId,
    action: "project.delete",
    payload: { projectId },
  });
  return { doId: rows[0].doId };
}

/**
 * One-shot project + access + role lookup. Replaces three separate calls
 * (`getProjectRow` + `userCanAccessProject` + `getProjectRoleForUser`)
 * with a single JOIN. Returns `null` for projects the user can't access,
 * so the caller does a single null-check.
 */
export async function getProjectAccessSummary(
  d1: D1Database,
  projectId: string,
  userId: string
): Promise<
  | {
      id: string;
      name: string;
      doId: string;
      orgId: string;
      orgName: string;
      orgSlug: string;
      retentionDays: number;
      maxEventsPerMonth: number | null;
      role: OrgRole;
    }
  | null
> {
  const db = createDb(d1);
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      doId: projects.doId,
      orgId: projects.orgId,
      orgName: organizations.name,
      orgSlug: organizations.slug,
      retentionDays: projects.retentionDays,
      maxEventsPerMonth: projects.maxEventsPerMonth,
      role: organizationMembers.role,
    })
    .from(projects)
    .innerJoin(organizations, eq(projects.orgId, organizations.id))
    .innerJoin(
      organizationMembers,
      and(
        eq(organizationMembers.orgId, projects.orgId),
        eq(organizationMembers.userId, userId)
      )
    )
    .where(eq(projects.id, projectId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getProjectRow(d1: D1Database, projectId: string) {
  const db = createDb(d1);
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      doId: projects.doId,
      externalId: projects.externalId,
      orgName: organizations.name,
      orgSlug: organizations.slug,
      retentionDays: projects.retentionDays,
      maxEventsPerMonth: projects.maxEventsPerMonth,
    })
    .from(projects)
    .innerJoin(organizations, eq(projects.orgId, organizations.id))
    .where(eq(projects.id, projectId))
    .limit(1);
  return rows[0];
}

/**
 * Resolve a project by its DSN-facing numeric `externalId` rather than its
 * slug `id` — used by routes reached via a Sentry-style DSN (e.g. the CLI's
 * `debug-files` upload), where the URL segment is the external id, not the
 * project slug.
 */
export async function getProjectRowByExternalId(
  d1: D1Database,
  rawExternalId: string
) {
  if (!/^\d+$/.test(rawExternalId)) return undefined;
  const db = createDb(d1);
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      doId: projects.doId,
      externalId: projects.externalId,
      orgName: organizations.name,
      orgSlug: organizations.slug,
      retentionDays: projects.retentionDays,
      maxEventsPerMonth: projects.maxEventsPerMonth,
    })
    .from(projects)
    .innerJoin(organizations, eq(projects.orgId, organizations.id))
    .where(eq(projects.externalId, Number(rawExternalId)))
    .limit(1);
  return rows[0];
}

/** Update retention + quota fields. admin+ only — checked at the route. */
export async function updateProjectQuota(
  d1: D1Database,
  input: {
    projectId: string;
    actingUserId: string;
    retentionDays: number;
    maxEventsPerMonth: number | null;
  }
): Promise<void> {
  const role = await getProjectRoleForUser(
    d1,
    input.actingUserId,
    input.projectId
  );
  if (!role || !orgRoleAtLeast(role, "admin")) {
    throw new Error("プロジェクト設定の変更には admin 以上が必要です");
  }
  const clampedRetention = Math.max(
    1,
    Math.min(365, Math.floor(input.retentionDays))
  );
  const clampedQuota =
    input.maxEventsPerMonth === null
      ? null
      : Math.max(1, Math.floor(input.maxEventsPerMonth));
  const db = createDb(d1);
  await db
    .update(projects)
    .set({
      retentionDays: clampedRetention,
      maxEventsPerMonth: clampedQuota,
    })
    .where(eq(projects.id, input.projectId));
  await recordAuditEvent(d1, {
    actorUserId: input.actingUserId,
    projectId: input.projectId,
    action: "project.quota.update",
    payload: {
      retentionDays: clampedRetention,
      maxEventsPerMonth: clampedQuota,
    },
  });
}

/**
 * Creates a project row, Durable Object id, and API key (hashed). Returns the plain key once.
 */
export async function createProjectWithApiKey(
  d1: D1Database,
  env: Env,
  input: {
    orgId: string;
    name: string;
    projectId?: string;
    actingUserId: string;
  }
): Promise<{
  projectId: string;
  externalId: number;
  doId: string;
  plainKey: string;
  hint: string;
}> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Project name is required");
  }

  let projectId = input.projectId?.trim();
  if (!projectId) {
    projectId = `wan_${crypto.randomUUID()}`;
  }
  if (projectId.length < 2 || !PROJECT_ID_RE.test(projectId)) {
    throw new Error(
      "Project ID must be 2–64 chars: letters, numbers, underscore, hyphen, dot"
    );
  }

  const db = createDb(d1);
  const orgRows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, input.orgId))
    .limit(1);
  if (orgRows.length === 0) {
    throw new Error("Organization not found");
  }

  const mrole = await getOrgMembership(d1, input.actingUserId, input.orgId);
  if (!mrole) {
    throw new Error("この組織にプロジェクトを作成する権限がありません");
  }
  if (!orgRoleAtLeast(mrole, "admin")) {
    throw new Error(
      "プロジェクト作成には admin 以上の必要があります（member にはできません）"
    );
  }

  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (existing.length > 0) {
    throw new Error("Project ID already exists");
  }

  const doId = env.PROJECT_DO.newUniqueId().toString();
  const plainKey = generateSentryPublicKey();
  const keyHash = await hashDsnKey(plainKey);
  const hint = apiKeyHint(plainKey);
  const now = Date.now();

  // externalId is randomly generated (900M possible values) — a handful of
  // uniqueness retries makes collisions practically impossible without
  // needing a DB sequence.
  let externalId = generateNumericExternalId();
  for (let attempt = 0; attempt < 5; attempt++) {
    const clash = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.externalId, externalId))
      .limit(1);
    if (clash.length === 0) break;
    externalId = generateNumericExternalId();
  }

  await db.insert(projects).values({
    id: projectId,
    orgId: input.orgId,
    name,
    doId,
    externalId,
    createdAt: new Date(now),
  });

  await db.insert(apiKeys).values({
    id: crypto.randomUUID(),
    projectId,
    keyHash,
    hint,
    isActive: true,
    createdAt: new Date(now),
  });

  await recordAuditEvent(d1, {
    actorUserId: input.actingUserId,
    orgId: input.orgId,
    projectId,
    action: "project.create",
    payload: { name, hint },
  });

  return { projectId, externalId, doId, plainKey, hint };
}
