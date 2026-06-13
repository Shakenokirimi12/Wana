import type { QueueMessage } from "@wana/types";
import type { Env } from "./types";
import { ProjectDataStore } from "./do/ProjectDataStore";
import { durableObjectIdForStoredProject } from "@wana/core";

export { ProjectDataStore };

/**
 * Sentry event ids are 32 hex chars, but some SDKs/tools send a dashed UUID.
 * Accept hex + dashes (32–36 chars) — still path-safe (no `/`, `.`, `..`) for
 * use as an R2 key / DO PK — and reject anything else.
 */
const EVENT_ID_RE = /^[0-9a-f-]{32,36}$/i;

export default {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/health") {
      return Response.json({ status: "ok", service: "wana-worker" });
    }
    return new Response("Not Found", { status: 404 });
  },

  // Queue consumer handler
  async queue(
    batch: MessageBatch<QueueMessage>,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
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
        } catch (error) {
          console.error(`insertEvents failed for DO ${doId}, will retry:`, error);
          for (const r of ready) r.msg.retry();
        }
      }
    );

    await Promise.all(promises);
  },
};
