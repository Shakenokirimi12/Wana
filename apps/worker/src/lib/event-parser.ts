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
  };
}
