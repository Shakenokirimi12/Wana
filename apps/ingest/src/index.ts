import { Hono } from "hono";
import { cors } from "hono/cors";
import { authMiddleware } from "./middleware/auth";
import { parseEnvelope } from "./utils/envelope";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

// Cloudflare Queues cap a message at 128 KB; the envelope is the bulk of the
// message body. Reject oversized payloads early with 413 instead of failing
// opaquely at send() time.
const MAX_ENVELOPE_BYTES = 110_000;

interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

// One-time warning so a misconfigured deploy (missing limiter binding) is
// visible in logs instead of silently running with no throttling.
const warnedMissing = new Set<string>();

/**
 * Returns true if the request is allowed. Explicit policy:
 * - binding absent  → ALLOW (fail-open) + warn once (deploy is unthrottled).
 * - limiter throws  → ALLOW (fail-open) + warn (don't drop traffic on a
 *   transient limiter error); previously this leaked a 500 to the client.
 * - limiter says no → DENY.
 */
async function rateLimitAllows(
  rl: RateLimitBinding | undefined,
  key: string,
  label: string
): Promise<boolean> {
  if (!rl) {
    if (!warnedMissing.has(label)) {
      warnedMissing.add(label);
      console.warn(`Rate limiter "${label}" binding absent — requests unthrottled`);
    }
    return true;
  }
  try {
    const { success } = await rl.limit({ key });
    return success;
  } catch (err) {
    console.warn(`Rate limiter "${label}" failed (fail-open):`, err);
    return true;
  }
}

app.use("*", cors());

// Coarse per-IP rate limit BEFORE auth so invalid keys can't amplify D1 reads.
app.use("*", async (c, next) => {
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  if (!(await rateLimitAllows(c.env.INGEST_IP_RATE_LIMITER, ip, "per-ip"))) {
    return c.json({ error: "Rate limit exceeded" }, 429);
  }
  return next();
});

app.get("/health", (c) => {
  return c.json({ status: "ok", service: "wana-ingest" });
});

// Sentry-compatible envelope endpoint
app.post("/api/:projectId/envelope/", authMiddleware, async (c) => {
  const projectId = c.req.param("projectId");
  const doId = c.get("doId");

  // Per-project rate limit (only authenticated requests count toward the key).
  if (!(await rateLimitAllows(c.env.INGEST_RATE_LIMITER, projectId, "per-project"))) {
    return c.json({ error: "Rate limit exceeded" }, 429);
  }

  try {
    const body = await c.req.text();
    if (new TextEncoder().encode(body).byteLength > MAX_ENVELOPE_BYTES) {
      return c.json({ error: "Payload too large" }, 413);
    }
    const parsed = parseEnvelope(body);

    if (parsed.kind === "malformed") {
      return c.json({ error: "Invalid envelope format" }, 400);
    }

    if (parsed.kind === "noop") {
      // Sentry SDK also sends client_report / session envelopes; respond 200 like SaaS.
      return c.json({ id: crypto.randomUUID().replace(/-/g, "") }, 200);
    }

    const envelope = parsed.envelope;

    // Send to queue for async processing
    await c.env.ERROR_QUEUE.send({
      projectId,
      doId,
      envelope,
      receivedAt: Date.now(),
    });

    return c.json({ id: envelope.header.event_id }, 200);
  } catch (error) {
    console.error("Failed to process envelope:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Legacy Sentry store endpoint (some SDKs use this)
app.post("/api/:projectId/store/", authMiddleware, async (c) => {
  const projectId = c.req.param("projectId");
  const doId = c.get("doId");

  if (!(await rateLimitAllows(c.env.INGEST_RATE_LIMITER, projectId, "per-project"))) {
    return c.json({ error: "Rate limit exceeded" }, 429);
  }

  try {
    const raw = await c.req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_ENVELOPE_BYTES) {
      return c.json({ error: "Payload too large" }, 413);
    }
    const payload = JSON.parse(raw);
    const eventId = payload.event_id || crypto.randomUUID();

    const envelope = {
      header: {
        event_id: eventId,
        sent_at: new Date().toISOString(),
      },
      items: [
        {
          header: { type: "event" as const },
          payload,
        },
      ],
    };

    await c.env.ERROR_QUEUE.send({
      projectId,
      doId,
      envelope,
      receivedAt: Date.now(),
    });

    return c.json({ id: eventId }, 200);
  } catch (error) {
    console.error("Failed to process store request:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default app;
