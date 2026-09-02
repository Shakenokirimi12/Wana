import { createMiddleware } from "hono/factory";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, isNull } from "drizzle-orm";
import { personalAccessTokens } from "@wana/schema/control-plane";
import { hashHex } from "@wana/core";
import type { Env } from "./types";

/**
 * Bearer-token auth for the remote MCP server. Tokens are issued from the
 * dashboard's /settings/tokens page and carry no scopes of their own — a
 * request authenticated with one can reach exactly what that user can
 * already see in the dashboard (checked per-tool via org membership).
 */
export const patAuthMiddleware = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const match = header.match(/^Bearer\s+(\S+)$/i);
    if (!match) {
      return c.json(
        { error: "Missing Authorization: Bearer <personal access token>" },
        401
      );
    }
    const token = match[1];
    const tokenHash = await hashHex(token);

    const db = drizzle(c.env.DB_CONTROL);
    const rows = await db
      .select({
        id: personalAccessTokens.id,
        userId: personalAccessTokens.userId,
      })
      .from(personalAccessTokens)
      .where(
        and(
          eq(personalAccessTokens.tokenHash, tokenHash),
          isNull(personalAccessTokens.revokedAt)
        )
      )
      .limit(1);

    if (rows.length === 0) {
      return c.json({ error: "Invalid or revoked token" }, 401);
    }

    c.set("userId", rows[0].userId);

    // Best-effort last-used timestamp — never block the request on it, but
    // still surface a failure so a persistently-stale lastUsedAt is visible
    // in logs instead of silently masked.
    c.executionCtx.waitUntil(
      db
        .update(personalAccessTokens)
        .set({ lastUsedAt: new Date() })
        .where(eq(personalAccessTokens.id, rows[0].id))
        .catch((err) => {
          console.warn("[mcp] failed to update personal_access_tokens.last_used_at:", err);
        })
    );

    await next();
  }
);
