import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { drizzle } from "drizzle-orm/d1";

import { sessions } from "@wana/schema/control-plane";

import type { Env } from "@/types/bindings";
import {
  DEV_FALLBACK_SUPPRESS_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "@/middleware/session";

const SESSION_DAYS = 30;

/** Inserts a D1 session row and sets `wana_session`; clears dev-fallback suppress cookie. */
export async function createDashboardSession(
  c: Context<{ Bindings: Env }>,
  userId: string
): Promise<void> {
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
