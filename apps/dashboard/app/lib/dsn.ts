/** SHA-256 hex digest of the DSN public key (must match ingest `hashDsn`). */
export async function hashDsnKey(publicKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(publicKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Public component used as `sentry_key` (alphanumeric, ingest-safe). */
export function generateSentryPublicKey(): string {
  return `wana${randomHex(24)}`;
}

export function apiKeyHint(publicKey: string): string {
  return `…${publicKey.slice(-6)}`;
}
