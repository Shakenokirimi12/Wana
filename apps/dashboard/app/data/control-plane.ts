import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  apiKeys,
  organizationInvites,
  organizationMembers,
  organizationSlugRedirects,
  organizations,
  projects,
  users,
  webauthnCredentials,
} from "@wana/schema/control-plane";
import type { Env } from "../types/bindings";
import {
  apiKeyHint,
  generateSentryPublicKey,
  hashDsnKey,
} from "../lib/dsn";
import {
  generateInvitePlainToken,
  hashInviteToken,
} from "../lib/invite-token";

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

const PROJECT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}[a-zA-Z0-9]$/;

/** Organization URL slug: lowercase, hyphens, 2–63 chars. */
export const ORG_SLUG_RE =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeOrgSlug(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s;
}

export function normalizeUsernameKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

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

/** Team membership role, or null if not a member. */
export async function getOrgMembership(
  d1: D1Database,
  userId: string,
  orgId: string
): Promise<OrgRole | null> {
  const db = drizzle(d1);
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
  return r ?? null;
}

/**
 * Resolve org by current slug or legacy slug (organization_slug_redirects → canonical slug).
 */
export async function resolveOrganizationBySlug(
  d1: D1Database,
  slug: string
): Promise<{ orgId: string; slug: string; name: string } | null> {
  if (!slug) return null;
  const db = drizzle(d1);
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
  const db = drizzle(d1);
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

/**
 * Projects in the **active** organization (Slack-style team context).
 * When `activeOrgId` is null, returns an empty list.
 */
export async function listProjectsForDashboardUser(
  d1: D1Database,
  userId: string,
  activeOrgId: string | null
) {
  const db = drizzle(d1);
  if (!activeOrgId) {
    return [];
  }

  const role = await getOrgMembership(d1, userId, activeOrgId);
  if (!role) {
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
    .where(eq(projects.orgId, activeOrgId))
    .orderBy(asc(projects.name));
}

/** Organizations where the user may create projects (admin or owner). */
export async function listOrganizationsForProjectCreation(
  d1: D1Database,
  userId: string
) {
  const db = drizzle(d1);
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
      orgName: organizations.name,
      orgSlug: organizations.slug,
    })
    .from(projects)
    .innerJoin(organizations, eq(projects.orgId, organizations.id))
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
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.orgId, input.orgId),
        eq(organizationMembers.userId, input.actingUserId)
      )
    )
    .limit(1);
  const mrole = membership[0]?.role;
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

export async function getUserIdentityForInvite(
  d1: D1Database,
  userId: string
): Promise<{
  email: string;
  username: string | null;
} | null> {
  const db = drizzle(d1);
  const rows = await db
    .select({
      email: users.email,
      username: users.username,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function createOrganizationInvite(
  d1: D1Database,
  input: {
    orgId: string;
    actingUserId: string;
    role: "admin" | "member";
    maxUses: number;
    ttlHours: number;
    invitedEmail?: string | null;
  }
): Promise<{ inviteId: string; plainToken: string }> {
  const mrole = await getOrgMembership(d1, input.actingUserId, input.orgId);
  if (!mrole || !orgRoleAtLeast(mrole, "admin")) {
    throw new Error("招待を作成する権限がありません（admin 以上が必要です）");
  }

  const ttlMs =
    Math.min(Math.max(Number(input.ttlHours) || 24, 1), 24 * 90) *
    60 *
    60 *
    1000;
  const maxUses = Math.min(Math.max(Number(input.maxUses) || 1, 1), 10_000);

  const invitedUsername: string | null = null;

  let invitedEmail: string | null = null;
  if (input.invitedEmail?.trim()) {
    invitedEmail = input.invitedEmail.trim().toLowerCase();
  }

  const plainToken = generateInvitePlainToken();
  const tokenHash = await hashInviteToken(plainToken);
  const now = Date.now();
  const inviteId = crypto.randomUUID();

  const db = drizzle(d1);
  await db.insert(organizationInvites).values({
    id: inviteId,
    orgId: input.orgId,
    tokenHash,
    role: input.role,
    invitedEmail,
    invitedUsername,
    expiresAt: new Date(now + ttlMs),
    maxUses,
    useCount: 0,
    createdByUserId: input.actingUserId,
    createdAt: new Date(now),
  });

  return { inviteId, plainToken };
}

export type PendingInviteRow = {
  id: string;
  role: "admin" | "member";
  invitedEmail: string | null;
  invitedUsername: string | null;
  expiresAt: Date;
  maxUses: number;
  useCount: number;
  createdAt: Date;
};

export async function listPendingInvitesForOrg(
  d1: D1Database,
  orgId: string
): Promise<PendingInviteRow[]> {
  const db = drizzle(d1);
  const now = Date.now();
  const rows = await db
    .select({
      id: organizationInvites.id,
      role: organizationInvites.role,
      invitedEmail: organizationInvites.invitedEmail,
      invitedUsername: organizationInvites.invitedUsername,
      expiresAt: organizationInvites.expiresAt,
      maxUses: organizationInvites.maxUses,
      useCount: organizationInvites.useCount,
      createdAt: organizationInvites.createdAt,
    })
    .from(organizationInvites)
    .where(
      and(
        eq(organizationInvites.orgId, orgId),
        gt(organizationInvites.expiresAt, new Date(now))
      )
    );

  return rows.filter((r) => r.useCount < r.maxUses);
}

export async function revokeOrganizationInvite(
  d1: D1Database,
  input: { orgId: string; inviteId: string; actingUserId: string }
): Promise<boolean> {
  const mrole = await getOrgMembership(d1, input.actingUserId, input.orgId);
  if (!mrole || !orgRoleAtLeast(mrole, "admin")) {
    throw new Error("招待を取り消す権限がありません");
  }
  const db = drizzle(d1);
  const removed = await db
    .delete(organizationInvites)
    .where(
      and(
        eq(organizationInvites.id, input.inviteId),
        eq(organizationInvites.orgId, input.orgId)
      )
    )
    .returning({ id: organizationInvites.id });
  return removed.length > 0;
}

export async function getInviteDetailsForAccept(
  d1: D1Database,
  tokenPlain: string
): Promise<{
  inviteId: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: "admin" | "member";
  invitedEmail: string | null;
  invitedUsername: string | null;
  expiresAt: Date;
  maxUses: number;
  useCount: number;
} | null> {
  if (!tokenPlain) return null;
  const tokenHash = await hashInviteToken(tokenPlain);
  const db = drizzle(d1);
  const rows = await db
    .select({
      inviteId: organizationInvites.id,
      orgId: organizationInvites.orgId,
      orgName: organizations.name,
      orgSlug: organizations.slug,
      role: organizationInvites.role,
      invitedEmail: organizationInvites.invitedEmail,
      invitedUsername: organizationInvites.invitedUsername,
      expiresAt: organizationInvites.expiresAt,
      maxUses: organizationInvites.maxUses,
      useCount: organizationInvites.useCount,
    })
    .from(organizationInvites)
    .innerJoin(
      organizations,
      eq(organizationInvites.orgId, organizations.id)
    )
    .where(eq(organizationInvites.tokenHash, tokenHash))
    .limit(1);
  return rows[0] ?? null;
}

export type AcceptInviteResult =
  | { ok: true; kind: "joined"; orgId: string; orgSlug: string }
  | { ok: true; kind: "already_member"; orgId: string; orgSlug: string }
  | { ok: false; reason: string };

export async function acceptOrganizationInvite(
  d1: D1Database,
  tokenPlain: string,
  userId: string
): Promise<AcceptInviteResult> {
  const details = await getInviteDetailsForAccept(d1, tokenPlain);
  if (!details) {
    return { ok: false, reason: "招待が見つからないか無効です。" };
  }

  const now = Date.now();
  if (details.expiresAt.getTime() <= now) {
    return { ok: false, reason: "招待の有効期限が切れています。" };
  }
  if (details.useCount >= details.maxUses) {
    return { ok: false, reason: "招待の利用回数が上限に達しています。" };
  }

  const identity = await getUserIdentityForInvite(d1, userId);
  if (!identity) {
    return { ok: false, reason: "ユーザーが見つかりません。" };
  }

  if (details.invitedEmail) {
    if (identity.email.toLowerCase() !== details.invitedEmail.toLowerCase()) {
      return {
        ok: false,
        reason: "この招待は別のメールアドレス向けです。",
      };
    }
  }

  const existing = await getOrgMembership(d1, userId, details.orgId);
  if (existing) {
    return {
      ok: true,
      kind: "already_member",
      orgId: details.orgId,
      orgSlug: details.orgSlug,
    };
  }

  const db = drizzle(d1);
  await db.insert(organizationMembers).values({
    id: `om_${crypto.randomUUID()}`,
    orgId: details.orgId,
    userId,
    role: details.role,
  });

  await db
    .update(organizationInvites)
    .set({
      useCount: sql`${organizationInvites.useCount} + 1`,
    })
    .where(eq(organizationInvites.id, details.inviteId));

  return {
    ok: true,
    kind: "joined",
    orgId: details.orgId,
    orgSlug: details.orgSlug,
  };
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
  const db = drizzle(d1);
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

  const db = drizzle(d1);
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

/** Profile fields for signed-in header copy (no raw `users.id` in UI). */
export async function getUserDisplayById(
  d1: D1Database,
  userId: string
): Promise<{ name: string; email: string } | null> {
  const db = drizzle(d1);
  const rows = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getUserByEmail(
  d1: D1Database,
  email: string
): Promise<{ id: string; email: string; name: string } | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const db = drizzle(d1);
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);
  return rows[0] ?? null;
}

export async function listWebAuthnCredentialIdsForUser(
  d1: D1Database,
  userId: string
): Promise<string[]> {
  const db = drizzle(d1);
  const rows = await db
    .select({ credentialId: webauthnCredentials.credentialId })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId));
  return rows.map((r) => r.credentialId);
}

export type WebAuthnCredentialRow = {
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
};

export async function getWebAuthnCredentialByCredentialId(
  d1: D1Database,
  credentialId: string
): Promise<WebAuthnCredentialRow | null> {
  const db = drizzle(d1);
  const rows = await db
    .select({
      userId: webauthnCredentials.userId,
      credentialId: webauthnCredentials.credentialId,
      publicKey: webauthnCredentials.publicKey,
      counter: webauthnCredentials.counter,
    })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.credentialId, credentialId))
    .limit(1);
  const row = rows[0];
  return row ?? null;
}

export async function updateWebAuthnCredentialCounter(
  d1: D1Database,
  credentialId: string,
  counter: number
): Promise<void> {
  const db = drizzle(d1);
  await db
    .update(webauthnCredentials)
    .set({ counter })
    .where(eq(webauthnCredentials.credentialId, credentialId));
}

export async function insertWebAuthnCredential(
  d1: D1Database,
  input: {
    userId: string;
    credentialId: string;
    publicKeyBase64Url: string;
    counter: number;
    transportsJson: string | null;
  }
): Promise<void> {
  const db = drizzle(d1);
  const id = `wauthn_${crypto.randomUUID().replace(/-/g, "")}`;
  await db.insert(webauthnCredentials).values({
    id,
    userId: input.userId,
    credentialId: input.credentialId,
    publicKey: input.publicKeyBase64Url,
    counter: input.counter,
    transports: input.transportsJson,
    createdAt: new Date(),
  });
}

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Valid invite + existing user with matching email → WebAuthn registration allowed without global enrollment flag.
 */
export async function inviteTokenAllowsWebAuthnRegistration(
  d1: D1Database,
  tokenPlain: string,
  email: string
): Promise<boolean> {
  const details = await getInviteDetailsForAccept(d1, tokenPlain);
  if (!details) {
    return false;
  }
  const now = Date.now();
  if (details.expiresAt.getTime() <= now || details.useCount >= details.maxUses) {
    return false;
  }
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (
    details.invitedEmail &&
    details.invitedEmail.toLowerCase() !== normalized
  ) {
    return false;
  }
  const user = await getUserByEmail(d1, email);
  return !!user;
}

export type BootstrapFromInviteResult =
  | { ok: true; email: string; created: boolean }
  | { ok: false; reason: string };

/**
 * Creates a control-plane user row for an open or email-bound invite so passkey registration can proceed.
 */
export async function bootstrapUserFromInvite(
  d1: D1Database,
  tokenPlain: string,
  emailInput: string | undefined
): Promise<BootstrapFromInviteResult> {
  const details = await getInviteDetailsForAccept(d1, tokenPlain);
  if (!details) {
    return { ok: false, reason: "無効な招待です。" };
  }
  const now = Date.now();
  if (details.expiresAt.getTime() <= now) {
    return { ok: false, reason: "招待の有効期限が切れています。" };
  }
  if (details.useCount >= details.maxUses) {
    return { ok: false, reason: "この招待の利用回数が上限に達しています。" };
  }

  let email: string;
  if (details.invitedEmail) {
    email = details.invitedEmail.toLowerCase();
    if (emailInput?.trim()) {
      const g = emailInput.trim().toLowerCase();
      if (g !== email) {
        return { ok: false, reason: "この招待は別のメールアドレス向けです。" };
      }
    }
  } else {
    const raw = emailInput?.trim().toLowerCase();
    if (!raw || !SIMPLE_EMAIL_RE.test(raw)) {
      return { ok: false, reason: "有効なメールアドレスを入力してください。" };
    }
    email = raw;
  }

  const existing = await getUserByEmail(d1, email);
  if (existing) {
    const allows = await inviteTokenAllowsWebAuthnRegistration(
      d1,
      tokenPlain,
      email
    );
    if (allows) {
      return { ok: true, email, created: false };
    }
    return {
      ok: false,
      reason:
        "このメールアドレスは既に登録されています。招待と紐づかない場合はログインしてください。",
    };
  }

  const userId = `user_${crypto.randomUUID().replace(/-/g, "")}`;
  const localPart = email.split("@")[0] ?? "member";
  const name = localPart.length > 0 ? localPart.slice(0, 80) : "Member";

  const db = drizzle(d1);
  try {
    await db.insert(users).values({
      id: userId,
      email,
      name,
      createdAt: new Date(),
      username: null,
      emailVerifiedAt: new Date(),
    });
  } catch {
    return {
      ok: false,
      reason:
        "このメールまたはユーザー名は既に登録されています。既存のアカウントでログインしてください。",
    };
  }

  return { ok: true, email, created: true };
}
