import { and, asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  apiKeys,
  organizationMembers,
  organizations,
  projects,
} from "@wana/schema/control-plane";
import type { Env } from "../types/bindings";
import {
  apiKeyHint,
  generateSentryPublicKey,
  hashDsnKey,
} from "../lib/dsn";

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
  const db = drizzle(d1);
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

/** Projects in organizations the given user belongs to. */
export async function listProjectsForDashboardUser(
  d1: D1Database,
  userId: string
) {
  const db = drizzle(d1);
  const memberships = await db
    .select({ orgId: organizationMembers.orgId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId));

  const orgIds = memberships.map((m) => m.orgId);
  if (orgIds.length === 0) {
    return [];
  }

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
    .where(inArray(projects.orgId, orgIds))
    .orderBy(asc(projects.name));
}

export async function listOrganizationsForUser(
  d1: D1Database,
  userId: string
) {
  const db = drizzle(d1);
  const memberships = await db
    .select({ orgId: organizationMembers.orgId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId));

  const orgIds = memberships.map((m) => m.orgId);
  if (orgIds.length === 0) {
    return [];
  }

  return db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
    })
    .from(organizations)
    .where(inArray(organizations.id, orgIds))
    .orderBy(asc(organizations.name));
}

export async function userCanAccessProject(
  d1: D1Database,
  userId: string,
  projectId: string
): Promise<boolean> {
  const db = drizzle(d1);
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

export async function getProjectRow(d1: D1Database, projectId: string) {
  const db = drizzle(d1);
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      doId: projects.doId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return rows[0];
}

export async function listOrganizations(d1: D1Database) {
  const db = drizzle(d1);
  return db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
    })
    .from(organizations)
    .orderBy(asc(organizations.name));
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

  const db = drizzle(d1);
  const orgRows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, input.orgId))
    .limit(1);
  if (orgRows.length === 0) {
    throw new Error("Organization not found");
  }

  const membership = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.orgId, input.orgId),
        eq(organizationMembers.userId, input.actingUserId)
      )
    )
    .limit(1);
  if (membership.length === 0) {
    throw new Error("この組織にプロジェクトを作成する権限がありません");
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
