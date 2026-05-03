import type { Env as DashboardBindings } from "./types/bindings";

import type {} from "hono";

import "@hono/react-renderer";

declare module "hono" {
  interface Env {
    Bindings: DashboardBindings;
  }

  interface ContextVariableMap {
    maintenance: boolean;
    /** Session (or dev fallback); null if unauthenticated. */
    dashboardUserId: string | null;
    /** Active team org id when authenticated and user has memberships. */
    activeOrgId: string | null;
  }
}

declare module "@hono/react-renderer" {
  interface Props {
    title?: string;
  }
}
