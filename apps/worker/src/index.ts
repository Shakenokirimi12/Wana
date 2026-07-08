import type { QueueMessage } from "@wana/types";
import type { Env } from "./types";
import { ProjectDataStore } from "./do/ProjectDataStore";
import { Symbolicator } from "./do/Symbolicator";
import { symbolicateNativePayload } from "./symbolicate";
import { durableObjectIdForStoredProject } from "@wana/core";
import { EmailMessage } from "cloudflare:email";

export { ProjectDataStore, Symbolicator };

/**
 * Build an RFC-822 / MIME message for `cloudflare:email`. The binding wants
 * a raw string; we hand-craft a minimal multipart/alternative when both
 * text + html are present, else a single-part text/plain (or text/html).
 */
function buildRawMime(args: {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
}): string {
  const encodeSubject = (s: string): string =>
    // RFC 2047 encoded-word for non-ASCII subjects so Gmail displays them right.
    /^[\x20-\x7e]*$/.test(s)
      ? s
      : `=?UTF-8?B?${btoa(unescape(encodeURIComponent(s)))}?=`;
  const baseHeaders =
    `From: ${args.from}\r\n` +
    `To: ${args.to}\r\n` +
    `Subject: ${encodeSubject(args.subject)}\r\n` +
    `MIME-Version: 1.0\r\n` +
    (args.replyTo ? `Reply-To: ${args.replyTo}\r\n` : "");
  if (args.text && args.html) {
    const boundary = `----=_wana_${crypto.randomUUID().replace(/-/g, "")}`;
    return (
      baseHeaders +
      `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: text/plain; charset=UTF-8\r\n` +
      `Content-Transfer-Encoding: 8bit\r\n\r\n` +
      `${args.text}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: text/html; charset=UTF-8\r\n` +
      `Content-Transfer-Encoding: 8bit\r\n\r\n` +
      `${args.html}\r\n` +
      `--${boundary}--\r\n`
    );
  }
  const isHtml = !args.text && !!args.html;
  return (
    baseHeaders +
    `Content-Type: ${isHtml ? "text/html" : "text/plain"}; charset=UTF-8\r\n` +
    `Content-Transfer-Encoding: 8bit\r\n\r\n` +
    `${(isHtml ? args.html : args.text) ?? ""}\r\n`
  );
}

/**
 * Handle an internal send-mail RPC from the dashboard. Authenticated by a
 * shared secret header — we cannot rely on "service-binding-only" because
 * Workers fetch handlers are invoked the same way regardless of binding
 * origin. The shared secret keeps a stray public request from sending mail.
 */
async function handleInternalSendMail(
  request: Request,
  env: Env
): Promise<Response> {
  const secret = env.INTERNAL_RPC_SECRET;
  if (!secret) {
    return Response.json(
      { ok: false, error: "INTERNAL_RPC_SECRET unset" },
      { status: 500 }
    );
  }
  if (request.headers.get("x-wana-internal-secret") !== secret) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!env.SEND_MAIL || !env.MAIL_FROM) {
    return Response.json(
      { ok: false, error: "email_not_configured" },
      { status: 503 }
    );
  }
  let body: {
    to?: string;
    subject?: string;
    text?: string;
    html?: string;
    replyTo?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "invalid_json" },
      { status: 400 }
    );
  }
  if (!body.to || !body.subject) {
    return Response.json(
      { ok: false, error: "to + subject required" },
      { status: 400 }
    );
  }
  const raw = buildRawMime({
    from: env.MAIL_FROM,
    to: body.to,
    subject: body.subject,
    text: body.text,
    html: body.html,
    replyTo: body.replyTo,
  });
  try {
    const msg = new EmailMessage(env.MAIL_FROM, body.to, raw);
    await env.SEND_MAIL.send(msg);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }
}

/**
 * Sentry event ids are 32 hex chars, but some SDKs/tools send a dashed UUID.
 * Accept hex + dashes (32–36 chars) — still path-safe (no `/`, `.`, `..`) for
 * use as an R2 key / DO PK — and reject anything else.
 */
const EVENT_ID_RE = /^[0-9a-f-]{32,36}$/i;

/**
 * Handle a re-symbolicate RPC from the dashboard. Used when the user
 * uploaded a dSYM AFTER the crash arrived: the original ingest path missed
 * the matching dSYM and shipped without a `symbols.json`. The dashboard
 * surfaces a "Re-symbolicate" button that POSTs here.
 *
 * Authenticated by the same shared secret as send-mail. Idempotent — we
 * just overwrite the symbols.json with the latest container output.
 */
async function handleInternalSymbolicate(
  request: Request,
  env: Env
): Promise<Response> {
  const secret = env.INTERNAL_RPC_SECRET;
  if (!secret) {
    return Response.json(
      { ok: false, error: "INTERNAL_RPC_SECRET unset" },
      { status: 500 }
    );
  }
  if (request.headers.get("x-wana-internal-secret") !== secret) {
    return new Response("Forbidden", { status: 403 });
  }
  let body: { projectId?: string; doId?: string; eventId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const { projectId, doId, eventId } = body;
  if (!projectId || !doId || !eventId) {
    return Response.json(
      { ok: false, error: "projectId + doId + eventId required" },
      { status: 400 }
    );
  }
  if (!EVENT_ID_RE.test(eventId)) {
    return Response.json(
      { ok: false, error: "bad eventId" },
      { status: 400 }
    );
  }
  const r2Key = `${projectId}/${eventId}.json`;
  const obj = await env.PAYLOAD_STORAGE.get(r2Key);
  if (!obj) {
    return Response.json(
      { ok: false, error: "event_not_found" },
      { status: 404 }
    );
  }
  const envelope = (await obj.json()) as {
    items?: Array<{ header?: { type?: string }; payload?: unknown }>;
  };
  const eventItem = envelope.items?.find(
    (it) => it.header?.type === "event" || it.header?.type === "error"
  );
  if (!eventItem?.payload) {
    return Response.json(
      { ok: false, error: "no_event_item" },
      { status: 422 }
    );
  }
  const id = durableObjectIdForStoredProject(env.PROJECT_DO, doId);
  const doStub = env.PROJECT_DO.get(id);
  let result: Awaited<ReturnType<typeof symbolicateNativePayload>>;
  try {
    result = await symbolicateNativePayload(env, doStub, eventItem.payload);
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "symbolicate_threw" },
      { status: 500 }
    );
  }
  if (!result) {
    return Response.json({ ok: true, resolved: 0, reason: "no_match" });
  }
  await env.PAYLOAD_STORAGE.put(
    `${r2Key}.symbols.json`,
    JSON.stringify({ version: 1, symbolsByUuid: result }),
    { httpMetadata: { contentType: "application/json" } }
  );
  const totalResolved = Object.values(result).reduce(
    (acc, frames) => acc + frames.filter((f) => !f.unresolved).length,
    0
  );
  return Response.json({ ok: true, resolved: totalResolved });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/health") {
      return Response.json({ status: "ok", service: "wana-worker" });
    }
    if (path === "/__internal/send-mail") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      return handleInternalSendMail(request, env);
    }
    if (path === "/__internal/symbolicate") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      return handleInternalSymbolicate(request, env);
    }
    return new Response("Not Found", { status: 404 });
  },

  // Queue consumer handler — handles both the main queue and the DLQ.
  async queue(
    batch: MessageBatch<QueueMessage>,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    // Audit BUG-3: DLQ messages used to accumulate forever with orphan R2
    // payloads. Branch on `batch.queue` so the DLQ consumer gets a tiny
    // cleanup pass instead of running the full ingest logic again.
    if (batch.queue === "wana-error-dlq") {
      await handleDeadLetter(batch, env);
      return;
    }

    // Check maintenance mode
    const maintenanceMode = await env.SYSTEM_CONFIG.get("MAINTENANCE_MODE");
    if (maintenanceMode === "true") {
      // Retry all messages later
      for (const message of batch.messages) {
        message.retry();
      }
      return;
    }

    // Group messages by DO ID for efficient batching
    const messagesByDo = new Map<string, Message<QueueMessage>[]>();

    for (const message of batch.messages) {
      const { doId } = message.body;
      const existing = messagesByDo.get(doId) || [];
      existing.push(message);
      messagesByDo.set(doId, existing);
    }

    // Process each DO's messages
    const promises = Array.from(messagesByDo.entries()).map(
      async ([doId, messages]) => {
        const id = durableObjectIdForStoredProject(env.PROJECT_DO, doId);
        const doStub = env.PROJECT_DO.get(id);

        // Store each payload in R2 independently so one bad message (or one
        // transient R2 error) doesn't drag down the rest of the batch.
        const ready: { msg: Message<QueueMessage>; event: {
          envelope: QueueMessage["envelope"];
          r2Key: string;
          receivedAt: number;
        } }[] = [];

        for (const msg of messages) {
          const { envelope, projectId, receivedAt } = msg.body;
          const eventId = envelope.header.event_id;

          // Invalid id is a permanent error — acking drops it (no infinite retry,
          // no path-injection into the R2 key).
          if (!EVENT_ID_RE.test(eventId)) {
            console.warn(
              `Dropping event with invalid event_id (project ${projectId}):`,
              eventId
            );
            msg.ack();
            continue;
          }

          const r2Key = `${projectId}/${eventId}.json`;
          try {
            await env.PAYLOAD_STORAGE.put(r2Key, JSON.stringify(envelope), {
              customMetadata: {
                projectId,
                eventId,
                receivedAt: String(receivedAt),
              },
            });
            ready.push({ msg, event: { envelope, r2Key, receivedAt } });
          } catch (error) {
            console.error(`R2 put failed for ${r2Key}, will retry:`, error);
            msg.retry();
          }
        }

        if (ready.length === 0) return;

        // All messages in this group share the same doId, and the DO is keyed
        // off projectId, so the first message's projectId is the group's.
        const groupProjectId = messages[0]?.body.projectId;

        try {
          // insertEvents is idempotent (ON CONFLICT DO NOTHING), so retrying the
          // whole group on failure is safe — no double counting.
          await doStub.insertEvents(ready.map((r) => r.event), groupProjectId);
          for (const r of ready) r.msg.ack();

          // Auto-symbolicate native events off the hot path. Failures here
          // are silently swallowed — the original event is already stored,
          // so the worst case is users see un-symbolicated stacks.
          if (groupProjectId) {
            ctx.waitUntil(
              maybeSymbolicateBatch(env, doStub, ready).catch((e) => {
                console.error("[symbolicate] batch failed:", e);
              })
            );
          }
        } catch (error) {
          console.error(`insertEvents failed for DO ${doId}, will retry:`, error);
          for (const r of ready) r.msg.retry();
        }
      }
    );

    await Promise.all(promises);
  },
};

/**
 * Dead-letter cleanup. For every message that exhausted retries on the
 * main queue, we delete the R2 payload that was written before the failing
 * DO call so it doesn't sit there forever, then ack regardless of success
 * (a stuck DLQ would defeat the purpose). One observability signal: log
 * the eventId so an operator can audit how often we hit this path.
 */
/**
 * Walk the batch and, for any event item with native frames (iOS / macOS
 * Mach-O `debug_meta.images`), call the Symbolicator container and stash
 * the resolved names in R2 at `<r2-key>.symbols.json`. The issue-detail
 * page overlays this on the raw stack when present.
 *
 * Runs inside `ctx.waitUntil` after the queue ack, so a slow container
 * never blocks ingest.
 */
async function maybeSymbolicateBatch(
  env: Env,
  doStub: DurableObjectStub<ProjectDataStore>,
  ready: Array<{
    event: {
      envelope: QueueMessage["envelope"];
      r2Key: string;
      receivedAt: number;
    };
  }>
): Promise<void> {
  for (const r of ready) {
    const eventItem = r.event.envelope.items.find(
      (it) => it.header.type === "event" || it.header.type === "error"
    );
    if (!eventItem) continue;
    const result = await symbolicateNativePayload(
      env,
      doStub,
      eventItem.payload as unknown
    );
    if (!result) continue;
    try {
      await env.PAYLOAD_STORAGE.put(
        `${r.event.r2Key}.symbols.json`,
        JSON.stringify({ version: 1, symbolsByUuid: result }),
        { httpMetadata: { contentType: "application/json" } }
      );
    } catch (e) {
      console.error(
        `[symbolicate] failed to persist symbols for ${r.event.r2Key}:`,
        e
      );
    }
  }
}

async function handleDeadLetter(
  batch: MessageBatch<QueueMessage>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const { projectId, envelope } = message.body;
      const eventId = envelope.header.event_id;
      if (
        typeof eventId === "string" &&
        EVENT_ID_RE.test(eventId) &&
        typeof projectId === "string" &&
        projectId.length > 0
      ) {
        const key = `${projectId}/${eventId}.json`;
        try {
          await env.PAYLOAD_STORAGE.delete(key);
        } catch (e) {
          console.error("DLQ: R2 cleanup failed for", key, e);
        }
        console.warn("DLQ: dropped event", projectId, eventId);
      } else {
        console.warn(
          "DLQ: message had invalid projectId/eventId; skipping R2 delete",
          {
            projectId: typeof projectId === "string" ? projectId.slice(0, 32) : "(non-string)",
          }
        );
      }
    } catch (e) {
      console.error("DLQ: unexpected error processing message:", e);
    } finally {
      message.ack();
    }
  }
}
