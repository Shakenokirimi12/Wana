import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  organizationInvites,
  organizations,
  users,
  webauthnCredentials,
} from "@wana/schema/control-plane";

import { hashInviteToken } from "./invite-token.js";

export async function countUsers(d1: D1Database): Promise<number> {
  const db = drizzle(d1);
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(users);
  return rows[0]?.count ?? 0;
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

export async function getInviteDetailsForAccept(
  d1: D1Database,
  tokenPlain: string
): Promise<{
  inviteId: string;
  orgId: string;
  invitedEmail: string | null;
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
      invitedEmail: organizationInvites.invitedEmail,
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

/**
 * Valid invite + existing user with matching email → WebAuthn registration allowed without global enrollment flag.
 */
export async function inviteTokenAllowsWebAuthnRegistration(
  d1: D1Database,
  tokenPlain: string,
  email: string
): Promise<boolean> {
  if (tokenPlain === "bootstrap-token") {
    // First-admin bootstrap only: exactly one user, that user is the target,
    // AND they have NO passkey yet. Once the admin registers a credential the
    // window closes, so an attacker can't enroll their own key on the account.
    const userCount = await countUsers(d1);
    if (userCount !== 1) return false;
    const user = await getUserByEmail(d1, email);
    if (!user) return false;
    const creds = await listWebAuthnCredentialIdsForUser(d1, user.id);
    return creds.length === 0;
  }
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
