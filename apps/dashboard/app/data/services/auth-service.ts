import { and, eq, gt, sql } from "drizzle-orm";
import {
  users,
  webauthnCredentials,
  organizationMembers,
  organizationInvites,
  organizations,
} from "@wana/schema/control-plane";
import { normalizeUsernameKey } from "@wana/core";
import {
  generateInvitePlainToken,
  hashInviteToken,
} from "../../lib/invite-token";
import { createDb } from "./db-client";
import { getOrgMembership, orgRoleAtLeast } from "./org-service";

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function getUserDisplayById(
  d1: D1Database,
  userId: string
): Promise<{ name: string; email: string; username: string | null } | null> {
  const db = createDb(d1);
  const rows = await db
    .select({ name: users.name, email: users.email, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

/** Update the current user's display name. */
export async function updateUserDisplayName(
  d1: D1Database,
  userId: string,
  name: string
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("名前を入力してください");
  const db = createDb(d1);
  await db
    .update(users)
    .set({ name: trimmed.slice(0, 80) })
    .where(eq(users.id, userId));
}

/** Passkeys registered to a user (account settings). */
export async function listWebAuthnCredentialsForUser(
  d1: D1Database,
  userId: string
) {
  const db = createDb(d1);
  return db
    .select({
      credentialId: webauthnCredentials.credentialId,
      createdAt: webauthnCredentials.createdAt,
      transports: webauthnCredentials.transports,
    })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId))
    .orderBy(webauthnCredentials.createdAt);
}

/** Remove a passkey — refuses to delete the user's last credential (lockout). */
export async function deleteWebAuthnCredential(
  d1: D1Database,
  userId: string,
  credentialId: string
): Promise<void> {
  const creds = await listWebAuthnCredentialIdsForUser(d1, userId);
  if (creds.length <= 1) {
    throw new Error(
      "最後のパスキーは削除できません（ロックアウト防止）。先に別のパスキーを追加してください。"
    );
  }
  const db = createDb(d1);
  await db
    .delete(webauthnCredentials)
    .where(
      and(
        eq(webauthnCredentials.userId, userId),
        eq(webauthnCredentials.credentialId, credentialId)
      )
    );
}

export async function getUserByEmail(
  d1: D1Database,
  email: string
): Promise<{ id: string; email: string; name: string } | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const db = createDb(d1);
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);
  return rows[0] ?? null;
}

export async function countUsers(d1: D1Database): Promise<number> {
  const db = createDb(d1);
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(users);
  return rows[0]?.count ?? 0;
}

export async function getUserIdentityForInvite(
  d1: D1Database,
  userId: string
): Promise<{
  email: string;
  username: string | null;
} | null> {
  const db = createDb(d1);
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

// WebAuthn
export async function listWebAuthnCredentialIdsForUser(
  d1: D1Database,
  userId: string
): Promise<string[]> {
  const db = createDb(d1);
  const rows = await db
    .select({ credentialId: webauthnCredentials.credentialId })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId));
  return rows.map((r) => r.credentialId);
}

export async function getWebAuthnCredentialByCredentialId(
  d1: D1Database,
  credentialId: string
) {
  const db = createDb(d1);
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
  return rows[0] ?? null;
}

export async function updateWebAuthnCredentialCounter(
  d1: D1Database,
  credentialId: string,
  counter: number
): Promise<void> {
  const db = createDb(d1);
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
  const db = createDb(d1);
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

// Invites
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

  const ttlMs = Math.min(Math.max(Number(input.ttlHours) || 24, 1), 24 * 90) * 60 * 60 * 1000;
  const maxUses = Math.min(Math.max(Number(input.maxUses) || 1, 1), 10_000);

  let invitedEmail: string | null = null;
  if (input.invitedEmail?.trim()) {
    invitedEmail = input.invitedEmail.trim().toLowerCase();
  }

  const plainToken = generateInvitePlainToken();
  const tokenHash = await hashInviteToken(plainToken);
  const now = Date.now();
  const inviteId = crypto.randomUUID();

  const db = createDb(d1);
  await db.insert(organizationInvites).values({
    id: inviteId,
    orgId: input.orgId,
    tokenHash,
    role: input.role,
    invitedEmail,
    invitedUsername: null,
    expiresAt: new Date(now + ttlMs),
    maxUses,
    useCount: 0,
    createdByUserId: input.actingUserId,
    createdAt: new Date(now),
  });

  return { inviteId, plainToken };
}

export async function listPendingInvitesForOrg(
  d1: D1Database,
  orgId: string
) {
  const db = createDb(d1);
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
  const db = createDb(d1);
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
) {
  if (!tokenPlain) return null;
  const tokenHash = await hashInviteToken(tokenPlain);
  const db = createDb(d1);
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
    .innerJoin(organizations, eq(organizationInvites.orgId, organizations.id))
    .where(eq(organizationInvites.tokenHash, tokenHash))
    .limit(1);
  return rows[0] ?? null;
}

export async function acceptOrganizationInvite(
  d1: D1Database,
  tokenPlain: string,
  userId: string
) {
  const details = await getInviteDetailsForAccept(d1, tokenPlain);
  if (!details) return { ok: false as const, reason: "招待が見つからないか無効です。" };

  const now = Date.now();
  if (details.expiresAt.getTime() <= now) return { ok: false as const, reason: "招待の有効期限が切れています。" };
  if (details.useCount >= details.maxUses) return { ok: false as const, reason: "招待の利用回数が上限に達しています。" };

  const identity = await getUserIdentityForInvite(d1, userId);
  if (!identity) return { ok: false as const, reason: "ユーザーが見つかりません。" };

  if (details.invitedEmail && identity.email.toLowerCase() !== details.invitedEmail.toLowerCase()) {
    return { ok: false as const, reason: "この招待は別のメールアドレス向けです。" };
  }

  const existing = await getOrgMembership(d1, userId, details.orgId);
  if (existing) {
    return {
      ok: true as const,
      kind: "already_member" as const,
      orgId: details.orgId,
      orgSlug: details.orgSlug,
    };
  }

  const db = createDb(d1);
  await db.insert(organizationMembers).values({
    id: `om_${crypto.randomUUID()}`,
    orgId: details.orgId,
    userId,
    role: details.role,
  });

  await db
    .update(organizationInvites)
    .set({ useCount: sql`${organizationInvites.useCount} + 1` })
    .where(eq(organizationInvites.id, details.inviteId));

  return {
    ok: true as const,
    kind: "joined" as const,
    orgId: details.orgId,
    orgSlug: details.orgSlug,
  };
}

export async function inviteTokenAllowsWebAuthnRegistration(
  d1: D1Database,
  tokenPlain: string,
  email: string
): Promise<boolean> {
  if (tokenPlain === "bootstrap-token") {
    // 1人目のブートストラップ専用: ユーザーが1人、対象本人、かつ未登録パスキー
    // のときのみ許可。管理者がパスキー登録済みなら窓を閉じる（乗っ取り防止）。
    const userCount = await countUsers(d1);
    if (userCount !== 1) return false;
    const user = await getUserByEmail(d1, email);
    if (!user) return false;
    const creds = await listWebAuthnCredentialIdsForUser(d1, user.id);
    return creds.length === 0;
  }
  const details = await getInviteDetailsForAccept(d1, tokenPlain);
  if (!details) return false;
  const now = Date.now();
  if (details.expiresAt.getTime() <= now || details.useCount >= details.maxUses) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  if (details.invitedEmail && details.invitedEmail.toLowerCase() !== normalized) return false;
  const user = await getUserByEmail(d1, email);
  if (!user) return false;
  // First-passkey enrollment only (see db.ts): block enrolling a credential on
  // an account that already has one via an invite — prevents account takeover.
  const creds = await listWebAuthnCredentialIdsForUser(d1, user.id);
  return creds.length === 0;
}

export async function bootstrapUserFromInvite(
  d1: D1Database,
  tokenPlain: string,
  emailInput: string | undefined,
  allowOpenSignup = false
) {
  let email: string;
  let isBootstrap = false;

  if (tokenPlain === "bootstrap-token") {
    const userCount = await countUsers(d1);
    if (userCount === 0) {
      isBootstrap = true;
      const raw = emailInput?.trim().toLowerCase();
      if (!raw || !SIMPLE_EMAIL_RE.test(raw)) return { ok: false as const, reason: "有効なメールアドレスを入力してください。" };
      email = raw;
    } else {
      return { ok: false as const, reason: "無効な招待です。" };
    }
  } else if (tokenPlain === "open-signup") {
    // Self-service signup: create an account for any new email, when enabled.
    if (!allowOpenSignup) {
      return { ok: false as const, reason: "セルフ登録は無効です。" };
    }
    const raw = emailInput?.trim().toLowerCase();
    if (!raw || !SIMPLE_EMAIL_RE.test(raw)) {
      return { ok: false as const, reason: "有効なメールアドレスを入力してください。" };
    }
    email = raw;
  } else {
    const details = await getInviteDetailsForAccept(d1, tokenPlain);
    if (!details) return { ok: false as const, reason: "無効な招待です。" };
    const now = Date.now();
    if (details.expiresAt.getTime() <= now) return { ok: false as const, reason: "招待の有効期限が切れています。" };
    if (details.useCount >= details.maxUses) return { ok: false as const, reason: "この招待の利用回数が上限に達しています。" };

    if (details.invitedEmail) {
      email = details.invitedEmail.toLowerCase();
      if (emailInput?.trim() && emailInput.trim().toLowerCase() !== email) {
        return { ok: false as const, reason: "この招待は別のメールアドレス向けです。" };
      }
    } else {
      const raw = emailInput?.trim().toLowerCase();
      if (!raw || !SIMPLE_EMAIL_RE.test(raw)) return { ok: false as const, reason: "有効なメールアドレスを入力してください。" };
      email = raw;
    }
  }

  const existing = await getUserByEmail(d1, email);
  if (existing) {
    const allows = await inviteTokenAllowsWebAuthnRegistration(d1, tokenPlain, email);
    if (allows) return { ok: true as const, email, created: false };
    return { ok: false as const, reason: "このメールアドレスは既に登録されています。" };
  }

  const userId = `user_${crypto.randomUUID().replace(/-/g, "")}`;
  const localPart = email.split("@")[0] ?? "member";
  const name = localPart.length > 0 ? localPart.slice(0, 80) : "Member";

  const db = createDb(d1);
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
    return { ok: false as const, reason: "登録に失敗しました。" };
  }

  return { ok: true as const, email, created: true };
}
