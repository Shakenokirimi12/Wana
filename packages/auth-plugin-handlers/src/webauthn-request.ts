import type { AuthPluginEnv } from "./env.js";

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1";
}

/**
 * On a non-loopback (production) host, WEBAUTHN_RP_ID / WEBAUTHN_ORIGIN MUST be
 * configured — deriving them from the request host would let a spoofed Host
 * shift the expected RP/origin. Fail closed rather than trust the request.
 */
function assertConfiguredForHost(host: string, env: AuthPluginEnv): void {
  if (isLoopback(host)) return;
  if (!env.WEBAUTHN_RP_ID?.trim() || !env.WEBAUTHN_ORIGIN?.trim()) {
    throw new Error(
      "WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN must be set in production (refusing to derive RP/origin from the request host)"
    );
  }
}

/** Relying Party ID for WebAuthn (defaults to request hostname on loopback). */
export function webauthnRpId(reqUrl: string, env: AuthPluginEnv): string {
  const fromEnv = env.WEBAUTHN_RP_ID?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const host = new URL(reqUrl).hostname;
  assertConfiguredForHost(host, env);
  return host;
}

export function webauthnExpectedOrigins(
  reqUrl: string,
  env: AuthPluginEnv
): string | string[] {
  const fromEnv = env.WEBAUTHN_ORIGIN?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  const url = new URL(reqUrl);
  const host = url.hostname;
  if (!isLoopback(host)) {
    assertConfiguredForHost(host, env);
    return url.origin;
  }
  const proto = url.protocol;
  const portPart = url.port ? `:${url.port}` : "";
  return [
    `${proto}//localhost${portPart}`,
    `${proto}//127.0.0.1${portPart}`,
  ];
}

export function webauthnRpName(env: AuthPluginEnv): string {
  return env.WEBAUTHN_RP_NAME?.trim() || "Wana";
}

export function webauthnExpectedRpIds(
  reqUrl: string,
  env: AuthPluginEnv
): string | string[] {
  const fromEnv = env.WEBAUTHN_RP_ID?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const host = new URL(reqUrl).hostname;
  if (isLoopback(host)) {
    return ["localhost", "127.0.0.1"];
  }
  assertConfiguredForHost(host, env);
  return host;
}
