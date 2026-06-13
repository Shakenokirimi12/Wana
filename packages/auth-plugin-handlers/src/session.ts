import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { and, eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { sessions } from "@wana/schema/control-plane";

import type { AuthPluginEnv } from "./env.js";

export const SESSION_COOKIE_NAME = "wana_session";

/** When present, `DASHBOARD_DEV_FALLBACK` + env user id is not applied (explicit sign-out). */
export const DEV_FALLBACK_SUPPRESS_COOKIE_NAME = "wana_no_dev_fb";

const SESSION_DAYS = 30;

/**
 * Sliding idle timeout: a session unused for this long is rejected even though
 * its absolute 30-day expiry hasn't passed. Limits the exploit window for a
 * cookie that's been captured but not yet used. Kept in sync with the dashboard
 * sessionMiddleware (which also refreshes `lastSeenAt` on activity).
 */
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

type Ctx = Context<{ Bindings: AuthPluginEnv }>;

/** Resolve the logged-in user id from the `wana_session` cookie (or null). */
export async function getSessionUserId(c: Ctx): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token) return null;
  const db = drizzle(c.env.DB_CONTROL);
  const rows = await db
    .select({ userId: sessions.userId, lastSeenAt: sessions.lastSeenAt })
    .from(sessions)
    .where(and(eq(sessions.id, token), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Reject idle sessions (sliding timeout) in addition to absolute expiry.
  const lastSeen = row.lastSeenAt?.getTime() ?? 0;
  if (Date.now() - lastSeen > SESSION_IDLE_MS) return null;
  return row.userId;
}

/** Inserts a D1 session row and sets `wana_session`; clears dev-fallback suppress cookie. */
export async function createDashboardSession(c: Ctx, userId: string): Promise<void> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const ua = c.req.header("User-Agent") ?? null;

  const db = drizzle(c.env.DB_CONTROL);
  await db.insert(sessions).values({
    id,
    userId,
    expiresAt: new Date(expiresAt),
    createdAt: new Date(now),
    userAgent: ua,
    lastSeenAt: new Date(now),
  });

  const secure = c.req.url.startsWith("https:");
  const base = { path: "/", secure, sameSite: "Lax" as const };
  setCookie(c, SESSION_COOKIE_NAME, id, {
    ...base,
    httpOnly: true,
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  deleteCookie(c, DEV_FALLBACK_SUPPRESS_COOKIE_NAME, { ...base, httpOnly: true });
}
