import { and, desc, eq, isNull } from "drizzle-orm";
import { personalAccessTokens } from "@wana/schema/control-plane";
import { generatePersonalAccessToken, apiKeyHint, hashHex } from "@wana/core";
import { createDb } from "./db-client";
import { recordAuditEvent } from "./audit-service";

/** Personal access tokens for the current user (newest first), never the hash. */
export async function listPersonalAccessTokens(d1: D1Database, userId: string) {
  const db = createDb(d1);
  return db
    .select({
      id: personalAccessTokens.id,
      name: personalAccessTokens.name,
      hint: personalAccessTokens.hint,
      createdAt: personalAccessTokens.createdAt,
      lastUsedAt: personalAccessTokens.lastUsedAt,
      revokedAt: personalAccessTokens.revokedAt,
    })
    .from(personalAccessTokens)
    .where(eq(personalAccessTokens.userId, userId))
    .orderBy(desc(personalAccessTokens.createdAt));
}

/** Issues a new personal access token for the remote MCP server. Returns the plain token once. */
export async function createPersonalAccessToken(
  d1: D1Database,
  userId: string,
  name: string
): Promise<{ plainToken: string; hint: string }> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("トークン名を入力してください");
  }
  if (trimmed.length > 80) {
    throw new Error("トークン名は80文字以内で入力してください");
  }
  const db = createDb(d1);
  const plainToken = generatePersonalAccessToken();
  const tokenHash = await hashHex(plainToken);
  const hint = apiKeyHint(plainToken);
  await db.insert(personalAccessTokens).values({
    id: `pat_${crypto.randomUUID().replace(/-/g, "")}`,
    userId,
    name: trimmed,
    tokenHash,
    hint,
    createdAt: new Date(),
  });
  await recordAuditEvent(d1, {
    actorUserId: userId,
    action: "pat.create",
    payload: { name: trimmed, hint },
  });
  return { plainToken, hint };
}

/** Revokes one of the caller's own tokens (idempotent). */
export async function revokePersonalAccessToken(
  d1: D1Database,
  userId: string,
  tokenId: string
): Promise<void> {
  const db = createDb(d1);
  await db
    .update(personalAccessTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(personalAccessTokens.id, tokenId),
        eq(personalAccessTokens.userId, userId),
        isNull(personalAccessTokens.revokedAt)
      )
    );
  await recordAuditEvent(d1, {
    actorUserId: userId,
    action: "pat.revoke",
    payload: { tokenId },
  });
}
