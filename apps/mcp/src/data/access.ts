import { and, asc, eq } from "drizzle-orm";
import {
  organizations,
  organizationMembers,
  projects,
} from "@wana/schema/control-plane";
import { createDb } from "./db";

/**
 * Projects the token's owner can see, across every org they belong to
 * (unlike the dashboard, an MCP session has no "active team" cookie).
 */
export async function listProjectsForUser(d1: D1Database, userId: string) {
  const db = createDb(d1);
  return db
    .select({
      id: projects.id,
      name: projects.name,
      doId: projects.doId,
      orgSlug: organizations.slug,
      orgName: organizations.name,
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
    .orderBy(asc(organizations.name), asc(projects.name));
}

/** A single project, only if the user is a member of its org. Null otherwise. */
export async function getAccessibleProject(
  d1: D1Database,
  userId: string,
  projectId: string
) {
  const db = createDb(d1);
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      doId: projects.doId,
      orgSlug: organizations.slug,
      orgName: organizations.name,
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
