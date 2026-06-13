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

type Ctx = Context<{ Bindings: AuthPluginEnv }>;

/** Resolve the logged-in user id from the `wana_session` cookie (or null). */
export async function getSessionUserId(c: Ctx): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token) return null;
  const db = drizzle(c.env.DB_CONTROL);
  const rows = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.id, token), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0]?.userId ?? null;
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
