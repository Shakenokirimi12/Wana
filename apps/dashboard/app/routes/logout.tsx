import { createRoute } from "honox/factory";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { sessions } from "@wana/schema/control-plane";

import { isDashboardDevFallback } from "@/lib/dashboard-user";
import {
  ACTIVE_ORG_COOKIE_NAME,
  DEV_FALLBACK_SUPPRESS_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "@/middleware/session";

/** Clears session cookie, active-org cookie, and D1 session row. */
export default createRoute(async (c) => {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (token) {
    const db = drizzle(c.env.DB_CONTROL);
    await db.delete(sessions).where(eq(sessions.id, token));
  }
  const secure = c.req.url.startsWith("https:");
  const base = { path: "/", secure, sameSite: "Lax" as const };
  deleteCookie(c, SESSION_COOKIE_NAME, { ...base, httpOnly: true });
  deleteCookie(c, ACTIVE_ORG_COOKIE_NAME, { ...base, httpOnly: true });
  if (isDashboardDevFallback(c.env)) {
    // Otherwise DASHBOARD_DEV_FALLBACK + DASHBOARD_USER_ID "re-logs in" on the next request.
    setCookie(c, DEV_FALLBACK_SUPPRESS_COOKIE_NAME, "1", {
      ...base,
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 400,
    });
  } else {
    deleteCookie(c, DEV_FALLBACK_SUPPRESS_COOKIE_NAME, { ...base, httpOnly: true });
  }
  return c.redirect("/login");
});
