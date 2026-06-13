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

app.use("*", cors());

app.get("/health", (c) => {
  return c.json({ status: "ok", service: "wana-ingest" });
});

// Sentry-compatible envelope endpoint
app.post("/api/:projectId/envelope/", authMiddleware, async (c) => {
  const projectId = c.req.param("projectId");
  const doId = c.get("doId");

  try {
    const body = await c.req.text();
    if (body.length > MAX_ENVELOPE_BYTES) {
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

  try {
    const raw = await c.req.text();
    if (raw.length > MAX_ENVELOPE_BYTES) {
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
