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

/** Sentinel error from readEnvelopeBody when the decoded payload exceeds
 *  MAX_ENVELOPE_BYTES. The route handler maps this to HTTP 413 instead of
 *  bubbling as a 400 (or worse — exhausting isolate memory). */
const ERR_PAYLOAD_TOO_LARGE = "payload_too_large";

/**
 * Read the request body as UTF-8 text, decompressing first when the client
 * declared `Content-Encoding: gzip` or `deflate`. The Sentry Cloudflare
 * Worker SDK (and the Node SDK) gzip-encodes envelopes by default; we have
 * to decode here or every event from a real Workers integration looks like
 * "malformed" downstream.
 *
 * Audit BUG-1: decompression is streamed and accumulated bytes are checked
 * against `MAX_ENVELOPE_BYTES` on every chunk so a small compressed
 * "zip bomb" can't expand to megabytes inside an isolate.
 */
async function readEnvelopeBody(request: Request): Promise<string> {
  const enc = (request.headers.get("content-encoding") ?? "")
    .trim()
    .toLowerCase();

  // Identity path — still measure against the same cap to keep error
  // responses uniform.
  if (!enc || enc === "identity") {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_ENVELOPE_BYTES) {
      throw new Error(ERR_PAYLOAD_TOO_LARGE);
    }
    return text;
  }

  const format = enc === "gzip" ? "gzip" : enc === "deflate" ? "deflate" : null;
  if (!format) {
    // Unknown encoding (e.g. `br`). Don't try to decode; downstream parse
    // will surface a clean 400.
    return request.text();
  }
  if (!request.body) return "";

  const decompressed = request.body.pipeThrough(
    new DecompressionStream(format)
  );
  const reader = decompressed.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_ENVELOPE_BYTES) {
        await reader.cancel(ERR_PAYLOAD_TOO_LARGE);
        throw new Error(ERR_PAYLOAD_TOO_LARGE);
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already locked away by cancel — fine.
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
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
  // authMiddleware resolves the URL's numeric external id to the project's
  // real slug id — use that (not the raw URL param) for rate-limit keys,
  // logs, and the queue message so downstream consumers (apps/worker) see
  // the same project id used everywhere else in the control plane.
  const projectId = c.get("projectId");
  const doId = c.get("doId");

  // Per-project rate limit (only authenticated requests count toward the key).
  if (!(await rateLimitAllows(c.env.INGEST_RATE_LIMITER, projectId, "per-project"))) {
    return c.json({ error: "Rate limit exceeded" }, 429);
  }

  try {
    let body: string;
    try {
      body = await readEnvelopeBody(c.req.raw);
    } catch (e) {
      // Don't echo the underlying decompressor error string to the client
      // (audit BUG-8: leaks zlib internals to anyone probing the surface).
      // Map the budget-exceeded sentinel to 413, everything else to 400.
      const msg = e instanceof Error ? e.message : "";
      if (msg === ERR_PAYLOAD_TOO_LARGE) {
        return c.json({ error: "Payload too large" }, 413);
      }
      console.warn("readEnvelopeBody failed:", msg);
      return c.json({ error: "Failed to decode body" }, 400);
    }
    const parsed = parseEnvelope(body);

    // Diagnostic v3: log a summary for EVERY envelope, regardless of
    // whether we end up queueing it. Lets us see how many event-vs-session
    // envelopes the SDK is shipping vs what we accept. `itemTypes` comes
    // from the walk parseEnvelope() already did, rather than re-splitting
    // and re-JSON.parsing the raw body a second time.
    const itemTypes = parsed.itemTypes;

    if (parsed.kind === "malformed") {
      console.warn(
        `[ingest] MALFORMED project=${projectId} types=${JSON.stringify(itemTypes)} bytes=${body.length}`
      );
      return c.json({ error: "Invalid envelope format" }, 400);
    }

    if (parsed.kind === "noop") {
      console.log(
        `[ingest] noop project=${projectId} types=${JSON.stringify(itemTypes)}`
      );
      return c.json({ id: crypto.randomUUID().replace(/-/g, "") }, 200);
    }

    console.log(
      `[ingest] queue project=${projectId} types=${JSON.stringify(itemTypes)} eid=${parsed.envelope.header.event_id}`
    );

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
  const projectId = c.get("projectId");
  const doId = c.get("doId");

  if (!(await rateLimitAllows(c.env.INGEST_RATE_LIMITER, projectId, "per-project"))) {
    return c.json({ error: "Rate limit exceeded" }, 429);
  }

  try {
    let raw: string;
    try {
      raw = await readEnvelopeBody(c.req.raw);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === ERR_PAYLOAD_TOO_LARGE) {
        return c.json({ error: "Payload too large" }, 413);
      }
      console.warn("readEnvelopeBody failed:", msg);
      return c.json({ error: "Failed to decode body" }, 400);
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
