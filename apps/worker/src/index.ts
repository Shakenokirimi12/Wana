import type { QueueMessage } from "@wana/types";
import type { Env } from "./types";
import { ProjectDataStore } from "./do/ProjectDataStore";
import { durableObjectIdForStoredProject } from "./lib/durable-id";

export { ProjectDataStore };

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
        try {
          const id = durableObjectIdForStoredProject(env.PROJECT_DO, doId);
          const doStub = env.PROJECT_DO.get(id);

          // Store payloads in R2 and collect metadata
          const events = await Promise.all(
            messages.map(async (msg) => {
              const { envelope, projectId, receivedAt } = msg.body;
              const eventId = envelope.header.event_id;
              const r2Key = `${projectId}/${eventId}.json`;

              // Store full payload in R2
              await env.PAYLOAD_STORAGE.put(
                r2Key,
                JSON.stringify(envelope),
                {
                  customMetadata: {
                    projectId,
                    eventId,
                    receivedAt: String(receivedAt),
                  },
                }
              );

              return {
                envelope,
                r2Key,
                receivedAt,
              };
            })
          );

          // Insert events into DO
          await doStub.insertEvents(events);

          // Acknowledge all messages
          for (const msg of messages) {
            msg.ack();
          }
        } catch (error) {
          console.error(`Failed to process messages for DO ${doId}:`, error);
          // Retry failed messages
          for (const msg of messages) {
            msg.retry();
          }
        }
      }
    );

    await Promise.all(promises);
  },
};
