import { createMiddleware } from "hono/factory";
import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import { apiKeys, projects } from "@wana/schema/control-plane";
import { extractSentryKeyFromRequest, hashHex as hashDsn } from "@wana/core";
import type { Env } from "../types";

// In-memory cache for authentication results (Worker isolates reuse this Map).
// NOTE: this is the revocation latency — a disabled key / deleted project keeps
// authenticating in a warm isolate until its entry expires. Kept short so revoke
// takes effect quickly; bounded so it can't grow without limit.
const AUTH_CACHE = new Map<string, { projectId: string; doId: string; expiresAt: number }>();
const DEFAULT_CACHE_TTL_MS = 10 * 1000;
const AUTH_CACHE_MAX = 5000;

/**
 * Cache TTL is also the worst-case revocation latency: a disabled key / deleted
 * project keeps authenticating in a warm isolate until its entry expires.
 * Operators can lower `INGEST_AUTH_CACHE_TTL_MS` to tighten that window (at the
 * cost of more D1 reads). Clamped to a sane range; falls back to the default
 * for unset/invalid values.
 */
function resolveCacheTtlMs(raw: string | undefined): number {
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0) return DEFAULT_CACHE_TTL_MS;
  return Math.min(n, 60 * 1000);
}

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

    // Cache the successful authentication (bounded: clear when full).
    if (AUTH_CACHE.size >= AUTH_CACHE_MAX) {
      AUTH_CACHE.clear();
    }
    AUTH_CACHE.set(cacheKey, {
      projectId: apiKey.projectId,
      doId: apiKey.doId,
      expiresAt: now + resolveCacheTtlMs(c.env.INGEST_AUTH_CACHE_TTL_MS),
    });

    c.set("doId", apiKey.doId);
    c.set("projectId", apiKey.projectId);

    await next();
  }
);
