import { createRoute } from "honox/factory";

import { isDashboardDevFallback } from "@/lib/dashboard-user";
import { createDashboardSession } from "@/lib/dashboard-session";

/**
 * Dev-only: create a real D1 session + Cookie for `DASHBOARD_USER_ID`.
 * POST only. Disabled when `DASHBOARD_DEV_FALLBACK` is unset.
 */
export const POST = createRoute(async (c) => {
  if (!isDashboardDevFallback(c.env, c)) {
    return c.text("Forbidden", 403);
  }
  const body = await c.req.parseBody();
  const rawNext = typeof body.next === "string" ? body.next : "";
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  const userId = c.env.DASHBOARD_USER_ID?.trim();
  if (!userId) {
    return c.text("DASHBOARD_USER_ID is not set", 400);
  }

  await createDashboardSession(c, userId);
  return c.redirect(next);
});

export default createRoute(async (c) => {
  return c.redirect("/login");
});
