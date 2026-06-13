import { createMiddleware } from "hono/factory";
import { getCookie, setCookie } from "hono/cookie";
import { and, eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { organizationMembers, sessions } from "@wana/schema/control-plane";

import { isDashboardDevFallback } from "../lib/dashboard-user";
import type { Env } from "../types/bindings";

const SESSION_COOKIE = "wana_session";
const ACTIVE_ORG_COOKIE = "wana_active_org";

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
export const ACTIVE_ORG_COOKIE_NAME = ACTIVE_ORG_COOKIE;

/** When present, `DASHBOARD_DEV_FALLBACK` + env user id is not applied (explicit sign-out). */
export const DEV_FALLBACK_SUPPRESS_COOKIE_NAME = "wana_no_dev_fb";

/**
 * Resolves `dashboardUserId` and `activeOrgId` from session cookie or dev fallback.
 */
export const sessionMiddleware = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    c.set("dashboardUserId", null);
    c.set("activeOrgId", null);

    const db = drizzle(c.env.DB_CONTROL);
    const now = Date.now();
    const token = getCookie(c, SESSION_COOKIE);

    let userId: string | null = null;

    if (token) {
      const rows = await db
        .select({
          userId: sessions.userId,
          id: sessions.id,
        })
        .from(sessions)
        .where(and(eq(sessions.id, token), gt(sessions.expiresAt, new Date(now))))
        .limit(1);
      if (rows.length > 0) {
        userId = rows[0].userId;
      }
    }

    if (!userId && isDashboardDevFallback(c.env, c)) {
      if (!getCookie(c, DEV_FALLBACK_SUPPRESS_COOKIE_NAME)) {
        const raw = c.env.DASHBOARD_USER_ID?.trim();
        if (raw) {
          userId = raw;
        }
      }
    }

    c.set("dashboardUserId", userId);

    if (!userId) {
      await next();
      return;
    }

    const memberships = await db
      .select({
        orgId: organizationMembers.orgId,
      })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, userId));

    const orgIds = new Set(memberships.map((m) => m.orgId));
    const cookieOrg = getCookie(c, ACTIVE_ORG_COOKIE);
    let activeOrgId: string | null = null;
    if (cookieOrg && orgIds.has(cookieOrg)) {
      activeOrgId = cookieOrg;
    } else if (memberships[0]) {
      activeOrgId = memberships[0].orgId;
    }

    c.set("activeOrgId", activeOrgId);

    if (activeOrgId && activeOrgId !== cookieOrg) {
      setCookie(c, ACTIVE_ORG_COOKIE, activeOrgId, {
        path: "/",
        httpOnly: true,
        secure: c.req.url.startsWith("https:"),
        sameSite: "Lax",
        maxAge: 60 * 60 * 24 * 400,
      });
    }

    await next();
  }
);
