import type {
  ParsedEnvelope,
  EnvelopeHeader,
  EnvelopeItemHeader,
  SentryEventPayload,
} from "@wana/types";

const dec = new TextDecoder("utf-8");

export type IngestEnvelopeResult =
  | { kind: "malformed"; itemTypes: string[] }
  /** Parsed OK (client_report / session / transaction-only, etc.) — accept like Sentry, do not queue. */
  | { kind: "noop"; itemTypes: string[] }
  | { kind: "queue"; envelope: ParsedEnvelope; itemTypes: string[] };

/**
 * Sentry envelope (RFC-style): header JSON line, then repeated { item header line, payload }.
 * Payload is either the next line (JSON) or exactly `length` UTF-8 bytes when item header has length > 0.
 * Browser SDK may omit top-level `event_id` or use item type `error` — see normalizeParsedEnvelope.
 */
export function parseEnvelope(body: string): IngestEnvelopeResult {
  const bytes = new TextEncoder().encode(body);
  let offset = 0;

  function readLine(): string {
    if (offset >= bytes.length) return "";
    const start = offset;
    let i = start;
    while (i < bytes.length && bytes[i] !== 0x0a) i++;
    const line = dec.decode(bytes.subarray(start, i)).replace(/\r$/, "");
    offset = i < bytes.length ? i + 1 : bytes.length;
    return line;
  }

  function readJsonLine(): unknown {
    const line = readLine();
    if (line === "") return null;
    return JSON.parse(line);
  }

  const items: ParsedEnvelope["items"] = [];
  const itemTypes = (): string[] =>
    items.map((i) => (typeof i.header.type === "string" ? i.header.type : "?")).slice(0, 12);

  try {
    const headerUnknown = readJsonLine() as Record<string, unknown> | null;
    if (!headerUnknown || typeof headerUnknown !== "object") {
      return { kind: "malformed", itemTypes: itemTypes() };
    }

    while (offset < bytes.length) {
      while (offset < bytes.length && bytes[offset] === 0x0a) offset++;
      if (offset >= bytes.length) break;

      const itemHeader = readJsonLine() as EnvelopeItemHeader | null;
      if (!itemHeader || typeof itemHeader !== "object") {
        break;
      }

      const rawLen = itemHeader.length;
      let payload: unknown;
      if (typeof rawLen === "number" && rawLen > 0) {
        const slice = bytes.subarray(offset, offset + rawLen);
        offset += rawLen;
        if (offset < bytes.length && bytes[offset] === 0x0a) offset += 1;
        payload = JSON.parse(dec.decode(slice));
      } else {
        const line = readLine();
        if (line === "") payload = {};
        else payload = JSON.parse(line);
      }

      items.push({
        header: itemHeader,
        payload: payload as SentryEventPayload | Record<string, unknown>,
      });
    }

    const normalized = normalizeParsedEnvelope(
      headerUnknown as EnvelopeHeader,
      items
    );
    if (normalized) {
      return { kind: "queue", envelope: normalized, itemTypes: itemTypes() };
    }
    return { kind: "noop", itemTypes: itemTypes() };
  } catch (error) {
    console.error("Failed to parse envelope:", error);
    return { kind: "malformed", itemTypes: itemTypes() };
  }
}

function normalizeParsedEnvelope(
  header: EnvelopeHeader,
  items: ParsedEnvelope["items"]
): ParsedEnvelope | null {
  let eventId = header.event_id;

  if (!eventId) {
    for (const item of items) {
      const t = item.header.type;
      if (t === "event" || t === "error") {
        const eid = (item.payload as { event_id?: string }).event_id;
        if (eid) {
          eventId = eid;
          break;
        }
      }
    }
  }

  if (!eventId) {
    return null;
  }

  return {
    header: { ...header, event_id: eventId },
    items,
  };
}
