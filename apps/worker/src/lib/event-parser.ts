import type { ParsedEnvelope, SentryException, SentryEventPayload } from "@wana/types";
import { calculateFingerprint, calculateMessageFingerprint } from "./fingerprint";

export interface ExtractedEventMetadata {
  fingerprint: string;
  type: string;
  value: string;
  timestamp: Date;
  culprit: string | null;
  environment: string | null;
  release: string | null;
  /** Normalized flat tag map. Keys lowercased + alphabet-validated, values capped at 200 chars. */
  tags: Record<string, string>;
}

const TAG_KEY_RE = /^[a-z0-9._-]{1,64}$/;
const MAX_TAG_VALUE_LEN = 200;

function coerceTagValue(raw: unknown): string | null {
  if (raw == null) return null;
  let s: string;
  if (typeof raw === "string") s = raw;
  else if (typeof raw === "number" || typeof raw === "boolean") s = String(raw);
  else return null; // skip objects/arrays — caller is responsible for flattening first
  s = s.trim();
  if (!s) return null;
  if (s.length > MAX_TAG_VALUE_LEN) {
    s = s.slice(0, MAX_TAG_VALUE_LEN - 1) + "…";
  }
  return s;
}

function putTag(out: Record<string, string>, rawKey: unknown, rawVal: unknown): void {
  if (typeof rawKey !== "string") return;
  const key = rawKey.toLowerCase();
  if (!TAG_KEY_RE.test(key)) return;
  const value = coerceTagValue(rawVal);
  if (value === null) return;
  out[key] = value; // last-wins on collision
}

/**
 * Sentry-compatible flat-tag extraction. Order matters: well-known fields and
 * known contexts are written FIRST, then `payload.tags` overrides them so the
 * SDK-supplied tag wins. We never extract from `payload.user` (PII) or from
 * unknown contexts (which can carry secrets like cookies).
 */
function extractTags(payload: SentryEventPayload): Record<string, string> {
  const out: Record<string, string> = {};

  // Well-known top-level fields → tag-like search tokens
  putTag(out, "level", payload.level);
  putTag(out, "platform", payload.platform);
  putTag(out, "environment", payload.environment);
  putTag(out, "release", payload.release);
  putTag(out, "logger", payload.logger);
  // dist/transaction/server_name aren't strongly-typed yet — read via cast.
  const anyPayload = payload as unknown as Record<string, unknown>;
  putTag(out, "dist", anyPayload.dist);
  putTag(out, "transaction", anyPayload.transaction);
  putTag(out, "server_name", anyPayload.server_name);

  // Known contexts — only flatten the allowlisted shapes
  const contexts = payload.contexts;
  if (contexts && typeof contexts === "object") {
    const c = contexts as Record<string, unknown>;
    const browser = c.browser as Record<string, unknown> | undefined;
    if (browser) {
      putTag(out, "browser.name", browser.name);
      putTag(out, "browser.version", browser.version);
      // Sentry's bar accepts plain `browser:` — alias to the name for nicer UX.
      if (typeof browser.name === "string") putTag(out, "browser", browser.name);
    }
    const os = c.os as Record<string, unknown> | undefined;
    if (os) {
      putTag(out, "os.name", os.name);
      putTag(out, "os.version", os.version);
      if (typeof os.name === "string") putTag(out, "os", os.name);
    }
    const runtime = c.runtime as Record<string, unknown> | undefined;
    if (runtime) {
      putTag(out, "runtime.name", runtime.name);
      putTag(out, "runtime.version", runtime.version);
      if (typeof runtime.name === "string") putTag(out, "runtime", runtime.name);
    }
    const device = c.device as Record<string, unknown> | undefined;
    if (device) {
      putTag(out, "device.family", device.family);
    }
    const app = c.app as Record<string, unknown> | undefined;
    if (app) {
      putTag(out, "app.version", app.app_version);
    }
  }

  // User-supplied `payload.tags` — wins on collision. Accepts both
  // `{k:v}` (server SDKs) and `[[k,v], ...]` (some browser SDK paths).
  const t = payload.tags as unknown;
  if (Array.isArray(t)) {
    for (const pair of t) {
      if (Array.isArray(pair) && pair.length === 2) {
        putTag(out, pair[0], pair[1]);
      }
    }
  } else if (t && typeof t === "object") {
    for (const [k, v] of Object.entries(t as Record<string, unknown>)) {
      putTag(out, k, v);
    }
  }

  return out;
}

export function parseEventFromEnvelope(
  envelope: ParsedEnvelope,
  receivedAt: number
): ExtractedEventMetadata | null {
  // Extract exception info from the first event item
  const eventItem = envelope.items.find(
    (item) => item.header.type === "event" || item.header.type === "error"
  );
  if (!eventItem) return null;

  const payload = eventItem.payload as SentryEventPayload;

  const exception = payload.exception?.values?.[0];
  const msg =
    typeof payload.message === "string" && payload.message.length > 0
      ? payload.message
      : null;

  if (!exception && !msg) return null;

  const fingerprint = exception
    ? calculateFingerprint(exception)
    : calculateMessageFingerprint(
        msg!,
        payload.level,
        payload.logger
      );

  const issueException: SentryException = exception ?? {
    type: (payload.level?.toUpperCase() ?? "MESSAGE") as string,
    value: msg!,
    stacktrace: undefined,
  };

  // Untrusted SDK timestamp: clamp to a sane window so a client can't pin an
  // issue at the top of the stream forever (future) or defer its retention for
  // decades. Allow small forward skew; floor implausibly-old values to receivedAt.
  const MAX_SKEW_MS = 60_000;
  const rawTs = payload.timestamp ? payload.timestamp * 1000 : receivedAt;
  const clamped =
    !Number.isFinite(rawTs) || rawTs > receivedAt + MAX_SKEW_MS || rawTs <= 0
      ? receivedAt
      : rawTs;
  const timestamp = new Date(clamped);

  let culprit: string | null = null;
  if (issueException.stacktrace?.frames?.length) {
    const topFrame =
      issueException.stacktrace.frames[
        issueException.stacktrace.frames.length - 1
      ];
    if (topFrame?.filename) {
      culprit = topFrame.lineno
        ? `${topFrame.filename}:${topFrame.lineno}`
        : topFrame.filename;
    }
  } else if (payload.logger) {
    culprit = payload.logger;
  }

  // SDK-supplied fields are untrusted; `type`/`value` back NOT NULL columns.
  // Coerce missing/non-string values so a malformed event can't poison the queue.
  const type =
    typeof issueException.type === "string" && issueException.type.length > 0
      ? issueException.type
      : "Error";
  const value =
    typeof issueException.value === "string" ? issueException.value : "";

  return {
    fingerprint,
    type,
    value,
    timestamp: Number.isNaN(timestamp.getTime()) ? new Date(receivedAt) : timestamp,
    culprit,
    environment:
      typeof payload.environment === "string" ? payload.environment : null,
    release: typeof payload.release === "string" ? payload.release : null,
    tags: extractTags(payload),
  };
}
