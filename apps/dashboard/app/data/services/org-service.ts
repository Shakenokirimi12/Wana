import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  organizations,
  organizationMembers,
  organizationSlugRedirects,
  users,
} from "@wana/schema/control-plane";
import { normalizeOrgSlug } from "@wana/core";
import { createDb } from "./db-client";
import { recordAuditEvent } from "./audit-service";

export type OrgRole = "owner" | "admin" | "member";

const roleRank: Record<OrgRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

export function orgRoleAtLeast(
  actual: OrgRole,
  required: OrgRole
): boolean {
  return roleRank[actual] >= roleRank[required];
}

/** Organization URL slug: lowercase, hyphens, 2–63 chars. */
export const ORG_SLUG_RE =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Team membership role, or null if not a member. */
export async function getOrgMembership(
  d1: D1Database,
  userId: string,
  orgId: string
): Promise<OrgRole | null> {
  const db = createDb(d1);
  const rows = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.orgId, orgId)
      )
    )
    .limit(1);
  const r = rows[0]?.role;
  return (r as OrgRole) ?? null;
}

/**
 * Resolve org by current slug or legacy slug (organization_slug_redirects → canonical slug).
 */
export async function resolveOrganizationBySlug(
  d1: D1Database,
  slug: string
): Promise<{ orgId: string; slug: string; name: string } | null> {
  if (!slug) return null;
  const db = createDb(d1);
  const direct = await db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
    })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  if (direct.length > 0) {
    return {
      orgId: direct[0].id,
      slug: direct[0].slug,
      name: direct[0].name,
    };
  }
  const viaRedirect = await db
    .select({
      orgId: organizationSlugRedirects.organizationId,
      slug: organizations.slug,
      name: organizations.name,
    })
    .from(organizationSlugRedirects)
    .innerJoin(
      organizations,
      eq(organizationSlugRedirects.organizationId, organizations.id)
    )
    .where(eq(organizationSlugRedirects.oldSlug, slug))
    .limit(1);
  if (viaRedirect.length > 0) {
    return {
      orgId: viaRedirect[0].orgId,
      slug: viaRedirect[0].slug,
      name: viaRedirect[0].name,
    };
  }
  return null;
}

/** Members of an org with profile fields (team settings UI). */
export async function listOrganizationMembersWithProfiles(
  d1: D1Database,
  orgId: string
) {
  const db = createDb(d1);
  return db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      username: users.username,
      role: organizationMembers.role,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(eq(organizationMembers.orgId, orgId))
    .orderBy(asc(users.name));
}

/** Change a member's role between member/admin (admin+; owners managed via transfer). */
export async function setMemberRole(
  d1: D1Database,
  input: {
    orgId: string;
    actorUserId: string;
    targetUserId: string;
    role: "admin" | "member";
  }
): Promise<void> {
  const actor = await getOrgMembership(d1, input.actorUserId, input.orgId);
  if (!actor || !orgRoleAtLeast(actor, "admin")) {
    throw new Error("メンバーのロール変更には admin 以上が必要です");
  }
  const target = await getOrgMembership(d1, input.targetUserId, input.orgId);
  if (!target) throw new Error("対象はこのチームのメンバーではありません");
  if (target === "owner") {
    throw new Error(
      "オーナーのロールはここで変更できません（オーナー移譲を使ってください）"
    );
  }
  const db = createDb(d1);
  await db
    .update(organizationMembers)
    .set({ role: input.role })
    .where(
      and(
        eq(organizationMembers.orgId, input.orgId),
        eq(organizationMembers.userId, input.targetUserId)
      )
    );
  await recordAuditEvent(d1, {
    actorUserId: input.actorUserId,
    orgId: input.orgId,
    action: "member.role_change",
    payload: { targetUserId: input.targetUserId, role: input.role },
  });
}

/** Remove a member from an org (admin+; owners cannot be removed). */
export async function removeMember(
  d1: D1Database,
  input: { orgId: string; actorUserId: string; targetUserId: string }
): Promise<void> {
  const actor = await getOrgMembership(d1, input.actorUserId, input.orgId);
  if (!actor || !orgRoleAtLeast(actor, "admin")) {
    throw new Error("メンバーの削除には admin 以上が必要です");
  }
  const target = await getOrgMembership(d1, input.targetUserId, input.orgId);
  if (!target) return;
  if (target === "owner") {
    throw new Error("オーナーは削除できません（先にオーナーを移譲してください）");
  }
  const db = createDb(d1);
  await db
    .delete(organizationMembers)
    .where(
      and(
        eq(organizationMembers.orgId, input.orgId),
        eq(organizationMembers.userId, input.targetUserId)
      )
    );
  await recordAuditEvent(d1, {
    actorUserId: input.actorUserId,
    orgId: input.orgId,
    action: "member.remove",
    payload: { targetUserId: input.targetUserId },
  });
}

/** Transfer ownership: actor (owner) demotes to admin, target becomes owner. */
export async function transferOwnership(
  d1: D1Database,
  input: { orgId: string; actorUserId: string; targetUserId: string }
): Promise<void> {
  const actor = await getOrgMembership(d1, input.actorUserId, input.orgId);
  if (actor !== "owner") {
    throw new Error("オーナー移譲はオーナーのみ実行できます");
  }
  if (input.targetUserId === input.actorUserId) {
    throw new Error("自分自身には移譲できません");
  }
  const target = await getOrgMembership(d1, input.targetUserId, input.orgId);
  if (!target) throw new Error("対象はこのチームのメンバーではありません");

  const db = createDb(d1);
  await db
    .update(organizationMembers)
    .set({ role: "owner" })
    .where(
      and(
        eq(organizationMembers.orgId, input.orgId),
        eq(organizationMembers.userId, input.targetUserId)
      )
    );
  await db
    .update(organizationMembers)
    .set({ role: "admin" })
    .where(
      and(
        eq(organizationMembers.orgId, input.orgId),
        eq(organizationMembers.userId, input.actorUserId)
      )
    );
  await recordAuditEvent(d1, {
    actorUserId: input.actorUserId,
    orgId: input.orgId,
    action: "member.transfer_ownership",
    payload: { targetUserId: input.targetUserId },
  });
}

export async function listOrganizationsForUser(
  d1: D1Database,
  userId: string
) {
  const db = createDb(d1);
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

export async function listOrganizations(d1: D1Database) {
  const db = createDb(d1);
  return db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
    })
    .from(organizations)
    .orderBy(asc(organizations.name));
}

export async function updateOrganizationDisplayName(
  d1: D1Database,
  input: { orgId: string; actingUserId: string; name: string }
): Promise<void> {
  const mrole = await getOrgMembership(d1, input.actingUserId, input.orgId);
  if (!mrole || !orgRoleAtLeast(mrole, "admin")) {
    throw new Error("チーム名を変更する権限がありません（admin 以上が必要です）");
  }
  const name = input.name.trim();
  if (!name) {
    throw new Error("チーム名を入力してください");
  }
  const db = createDb(d1);
  await db
    .update(organizations)
    .set({ name })
    .where(eq(organizations.id, input.orgId));
}

export async function updateOrganizationSlugWithRedirect(
  d1: D1Database,
  input: { orgId: string; actingUserId: string; newSlugRaw: string }
): Promise<{ slug: string }> {
  const mrole = await getOrgMembership(d1, input.actingUserId, input.orgId);
  if (!mrole || !orgRoleAtLeast(mrole, "admin")) {
    throw new Error("スラッグを変更する権限がありません（admin 以上が必要です）");
  }

  const slug = normalizeOrgSlug(input.newSlugRaw);
  if (slug.length < 2 || slug.length > 63 || !ORG_SLUG_RE.test(slug)) {
    throw new Error(
      "スラッグは 2〜63 文字の英小文字・数字・ハイフンで指定してください"
    );
  }

  const db = createDb(d1);
  const currentRows = await db
    .select({ slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.id, input.orgId))
    .limit(1);
  const currentSlug = currentRows[0]?.slug;
  if (!currentSlug) {
    throw new Error("組織が見つかりません");
  }
  if (currentSlug === slug) {
    return { slug };
  }

  const taken = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  if (taken.length > 0) {
    throw new Error("このスラッグは既に使われています");
  }

  const now = Date.now();
  await db.insert(organizationSlugRedirects).values({
    oldSlug: currentSlug,
    organizationId: input.orgId,
    createdAt: new Date(now),
  });

  await db
    .update(organizations)
    .set({ slug })
    .where(eq(organizations.id, input.orgId));

  return { slug };
}

export async function createOrganization(
  d1: D1Database,
  input: {
    name: string;
    slugRaw: string;
    actingUserId: string;
  }
): Promise<{ id: string; slug: string }> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("チーム名を入力してください");
  }

  const slug = normalizeOrgSlug(input.slugRaw);
  if (slug.length < 2 || slug.length > 63 || !ORG_SLUG_RE.test(slug)) {
    throw new Error(
      "スラッグは 2〜63 文字の英小文字・数字・ハイフンで指定してください"
    );
  }

  const db = createDb(d1);
  const taken = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  if (taken.length > 0) {
    throw new Error("このスラッグは既に使われています");
  }

  const orgId = `org_${crypto.randomUUID().replace(/-/g, "")}`;

  await db.insert(organizations).values({
    id: orgId,
    name,
    slug,
  });

  await db.insert(organizationMembers).values({
    id: `om_${crypto.randomUUID().replace(/-/g, "")}`,
    orgId,
    userId: input.actingUserId,
    role: "owner",
  });

  return { id: orgId, slug };
}
