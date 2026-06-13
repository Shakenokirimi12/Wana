import type { SentryException } from "@wana/types";

export function calculateFingerprint(exception: SentryException): string {
  const parts = [exception.type, exception.value];
  if (exception.stacktrace?.frames?.length) {
    const topFrame =
      exception.stacktrace.frames[exception.stacktrace.frames.length - 1];
    if (topFrame) {
      parts.push(
        topFrame.filename || "",
        topFrame.function || "",
        String(topFrame.lineno || "")
      );
    }
  }
  return parts.join("::");
}

/** Group non-exception message events (captureMessage / logger). */
export function calculateMessageFingerprint(
  message: string,
  level?: string,
  logger?: string
): string {
  return ["message", level ?? "info", message, logger ?? ""].join("::");
}
