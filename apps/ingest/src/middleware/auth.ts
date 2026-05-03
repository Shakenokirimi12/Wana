import { createMiddleware } from "hono/factory";
import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import { apiKeys, projects } from "@wana/schema/control-plane";
import { extractSentryKeyFromRequest, hashDsn } from "../utils/crypto";
import type { Env } from "../types";

export const authMiddleware = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const projectId = c.req.param("projectId");

    if (!projectId) {
      return c.json({ error: "Missing project ID" }, 400);
    }

    const sentryKey = extractSentryKeyFromRequest(c);
    if (!sentryKey) {
      return c.json(
        { error: "Missing authentication (X-Sentry-Auth or sentry_key query)" },
        401
      );
    }

    const keyHash = await hashDsn(sentryKey);

    const db = drizzle(c.env.DB_CONTROL);

    const result = await db
      .select({
        projectId: projects.id,
        doId: projects.doId,
        isActive: apiKeys.isActive,
      })
      .from(apiKeys)
      .innerJoin(projects, eq(apiKeys.projectId, projects.id))
      .where(and(eq(apiKeys.keyHash, keyHash), eq(projects.id, projectId)))
      .limit(1);

    if (result.length === 0) {
      return c.json({ error: "Invalid API key" }, 401);
    }

    const apiKey = result[0];

    if (!apiKey.isActive) {
      return c.json({ error: "API key is disabled" }, 401);
    }

    c.set("doId", apiKey.doId);
    c.set("projectId", apiKey.projectId);

    await next();
  }
);
