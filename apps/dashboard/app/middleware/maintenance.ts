import { createMiddleware } from "hono/factory";

import type { Env } from "../types/bindings";

/** Reads `SYSTEM_CONFIG` KV; matches consumer worker maintenance behavior. */
export const maintenanceMiddleware = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const flag = await c.env.SYSTEM_CONFIG.get("MAINTENANCE_MODE");
    c.set("maintenance", flag === "true");
    await next();
  }
);
