import type { SentryEventPayload } from "@wana/types";

/**
 * Parses a stored R2 event payload — either a bare Sentry event JSON or a
 * full envelope ({ items: [{ header, payload }] }) — into the event body.
 * Trimmed copy of the dashboard's `parseStoredEventPayload`
 * (apps/dashboard/app/ui/event-payload.tsx); this one skips the dSYM
 * symbolication merge, since MCP tool responses return raw (unsymbolicated)
 * frames — good enough for an AI agent reading a stack trace.
 */
export function parseStoredEventPayload(raw: string): SentryEventPayload | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;

  const obj = json as Record<string, unknown>;
  if ("exception" in obj || "breadcrumbs" in obj || "message" in obj) {
    return obj as unknown as SentryEventPayload;
  }

  const items = (obj as { items?: unknown }).items;
  if (Array.isArray(items)) {
    for (const item of items) {
      const header = (item as { header?: { type?: string } })?.header;
      if (header?.type === "event" || header?.type === "error") {
        const payload = (item as { payload?: unknown }).payload;
        if (payload && typeof payload === "object") {
          return payload as SentryEventPayload;
        }
      }
    }
  }
  return null;
}
