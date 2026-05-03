export async function hashDsn(dsn: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(dsn);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function parseSentryAuthHeader(
  header: string
): { sentryKey: string } | null {
  // Format: Sentry sentry_version=7, sentry_client=..., sentry_key=<KEY>
  const match = header.match(/sentry_key=([a-zA-Z0-9_-]+)/);
  if (!match) {
    return null;
  }
  return { sentryKey: match[1] };
}

/**
 * Browser SDK sends `sentry_key` in the query string (not headers) to avoid CORS preflight.
 * See @sentry/core getEnvelopeEndpointWithUrlEncodedAuth.
 */
export function extractSentryKeyFromRequest(c: {
  req: {
    header: (name: string) => string | undefined;
    query: (name: string) => string | undefined;
  };
}): string | null {
  const authHeader =
    c.req.header("X-Sentry-Auth") || c.req.header("Authorization") || "";
  if (authHeader.trim()) {
    const parsed = parseSentryAuthHeader(authHeader);
    if (parsed) {
      return parsed.sentryKey;
    }
  }
  const q = c.req.query("sentry_key");
  if (q?.trim()) {
    return q.trim();
  }
  return null;
}
