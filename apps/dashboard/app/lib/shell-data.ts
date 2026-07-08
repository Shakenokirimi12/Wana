import type { Context } from "hono";

import {
  listOrganizationsForUser,
  listProjectsForDashboardUser,
} from "@/data/control-plane";
import { getActiveOrgId } from "@/lib/dashboard-user";
import type { Env } from "@/types/bindings";

/**
 * Per-request data the Shell sidebar needs: the active team chip, the team
 * switcher entries, and the project list in the active team. Signed-in
 * routes call this once and spread the result into `<Shell …/>`.
 *
 * Signed-out routes don't need this — they should pass nothing for sidebar
 * props and the Shell will render the "Sign in" CTA instead.
 */
export async function loadShellSidebar(
  c: Context<{ Bindings: Env }>,
  userId: string
): Promise<{
  projects: { id: string; name: string }[];
  activeTeamName?: string;
  activeTeamSlug?: string;
  teamSwitcher: { id: string; name: string; slug: string }[];
}> {
  const activeOrgId = getActiveOrgId(c);
  const [teams, projectRows] = await Promise.all([
    listOrganizationsForUser(c.env.DB_CONTROL, userId),
    listProjectsForDashboardUser(c.env.DB_CONTROL, userId, activeOrgId),
  ]);
  const active = teams.find((t) => t.id === activeOrgId);
  return {
    projects: projectRows.map((p) => ({ id: p.id, name: p.name })),
    activeTeamName: active?.name,
    activeTeamSlug: active?.slug,
    teamSwitcher: teams.map((t) => ({ id: t.id, name: t.name, slug: t.slug })),
  };
}
