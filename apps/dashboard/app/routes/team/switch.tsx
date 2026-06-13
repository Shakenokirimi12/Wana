import { createRoute } from "honox/factory";
import { setCookie } from "hono/cookie";

import { getOrgMembership } from "@/data/control-plane";
import { getDashboardUserId } from "@/lib/dashboard-user";
import { ACTIVE_ORG_COOKIE_NAME } from "@/middleware/session";

export default createRoute(async (c) => {
  const userId = getDashboardUserId(c);
  if (!userId) {
    return c.redirect("/login");
  }
  const orgId = c.req.query("id")?.trim();
  if (!orgId) {
    return c.redirect("/");
  }
  const role = await getOrgMembership(c.env.DB_CONTROL, userId, orgId);
  if (!role) {
    return c.redirect("/");
  }
  setCookie(c, ACTIVE_ORG_COOKIE_NAME, orgId, {
    path: "/",
    httpOnly: true,
    secure: c.req.url.startsWith("https:"),
    sameSite: "Lax",
    maxAge: 60 * 60 * 24 * 400,
  });
  // Only allow same-origin relative paths. Reject protocol-relative (`//host`)
  // and backslash (`/\host`) forms, which browsers treat as cross-origin.
  const rawNext = c.req.query("next")?.trim() ?? "";
  const next =
    rawNext.startsWith("/") &&
    !rawNext.startsWith("//") &&
    !rawNext.startsWith("/\\")
      ? rawNext
      : "/";
  return c.redirect(next);
});
