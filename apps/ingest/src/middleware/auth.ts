import { createMiddleware } from "hono/factory";
import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import { apiKeys, projects } from "@wana/schema/control-plane";
import { extractSentryKeyFromRequest, hashHex as hashDsn } from "@wana/core";
import type { Env } from "../types";

// In-memory cache for authentication results (Worker isolates reuse this Map)
const AUTH_CACHE = new Map<string, { projectId: string; doId: string; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 1000;

export const authMiddleware = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const projectId = c.req.param("projectId");

    if (!projectId) {
      return c.json({ error: "Missing project ID" }, 400);
    }

    const sentryKey = extractSentryKeyFromRequest(c.req);
    if (!sentryKey) {
      return c.json(
        { error: "Missing authentication (X-Sentry-Auth or sentry_key query)" },
        401
      );
    }

    const keyHash = await hashDsn(sentryKey);
    const cacheKey = `${projectId}:${keyHash}`;
    const now = Date.now();

    // Check cache first
    const cached = AUTH_CACHE.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      c.set("doId", cached.doId);
      c.set("projectId", cached.projectId);
      return await next();
    }

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

    // Cache the successful authentication
    AUTH_CACHE.set(cacheKey, {
      projectId: apiKey.projectId,
      doId: apiKey.doId,
      expiresAt: now + CACHE_TTL_MS,
    });

    c.set("doId", apiKey.doId);
    c.set("projectId", apiKey.projectId);

    await next();
  }
);
