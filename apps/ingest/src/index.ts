import { Hono } from "hono";
import { cors } from "hono/cors";
import { authMiddleware } from "./middleware/auth";
import { parseEnvelope } from "./utils/envelope";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

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
    const payload = await c.req.json();
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
