import { and, asc, eq, or } from "drizzle-orm";
import {
  organizations,
  organizationMembers,
  projects,
  apiKeys,
} from "@wana/schema/control-plane";
import {
  apiKeyHint,
  generateSentryPublicKey,
  hashHex as hashDsnKey,
} from "@wana/core";
import { createDb } from "./db-client";
import { getOrgMembership, orgRoleAtLeast, type OrgRole } from "./org-service";
import type { Env } from "../../types/bindings";

const PROJECT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}[a-zA-Z0-9]$/;

/**
 * @sentry/core DSN parser keeps only a leading digit run when the segment mixes digits
 * with letters (e.g. UUID `8dcb…` → projectId `8`). Numeric-only ids stay as-is.
 */
function assertSentryDsnCompatibleProjectId(projectId: string): void {
  const isAllDigits = /^\d+$/.test(projectId);
  if (!isAllDigits && /^\d/.test(projectId)) {
    throw new Error(
      "Project ID は Sentry SDK の DSN 解釈と互換である必要があります。先頭が数字の場合は数字のみ（例: 42）、それ以外は英字やアンダースコアで始めてください（自動採番の UUID は wan_ 付きで作成されます）。"
    );
  }
}

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

export async function listApiKeysForProject(d1: D1Database, projectId: string) {
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
    .select({ doId: projects.doId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (rows.length === 0) {
    throw new Error("プロジェクトが見つかりません");
  }
  await db.delete(apiKeys).where(eq(apiKeys.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
  return { doId: rows[0].doId };
}

export async function getProjectRow(d1: D1Database, projectId: string) {
  const db = createDb(d1);
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      doId: projects.doId,
      orgName: organizations.name,
      orgSlug: organizations.slug,
    })
    .from(projects)
    .innerJoin(organizations, eq(projects.orgId, organizations.id))
    .where(eq(projects.id, projectId))
    .limit(1);
  return rows[0];
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
  assertSentryDsnCompatibleProjectId(projectId);

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

  await db.insert(projects).values({
    id: projectId,
    orgId: input.orgId,
    name,
    doId,
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

  return { projectId, doId, plainKey, hint };
}
