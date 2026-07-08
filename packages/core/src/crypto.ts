/** SHA-256 hex digest of a string (used for DSN public keys). */
export async function hashHex(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Public component used as `sentry_key` (alphanumeric). */
export function generateSentryPublicKey(): string {
  return `wana${randomHex(24)}`;
}

/**
 * Random 9-digit numeric id (100000000–999999999), for the DSN-compatible
 * `projects.external_id` surrogate — @sentry/core's DSN validator requires
 * the DSN's trailing path segment to be entirely digits (see external_id's
 * doc comment in packages/schema/src/control-plane.ts).
 */
export function generateNumericExternalId(): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return 100_000_000 + (bytes[0] % 900_000_000);
}

export function apiKeyHint(publicKey: string): string {
  return `…${publicKey.slice(-6)}`;
}

export function parseSentryAuthHeader(
  header: string
): { sentryKey: string } | null {
  const match = header.match(/sentry_key=([a-zA-Z0-9_-]+)/);
  return match ? { sentryKey: match[1] } : null;
}

/**
 * Extracts the Sentry public key from a request (header or query string).
 */
export function extractSentryKeyFromRequest(req: {
  header: (name: string) => string | undefined;
  query: (name: string) => string | any;
}): string | null {
  const authHeader =
    req.header("X-Sentry-Auth") || req.header("Authorization") || "";
  if (authHeader.trim()) {
    const parsed = parseSentryAuthHeader(authHeader);
    if (parsed) return parsed.sentryKey;
  }
  const q = req.query("sentry_key");
  if (q?.trim()) return q.trim();
  return null;
}
