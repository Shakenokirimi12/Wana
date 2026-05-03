import type { AuthPluginEnv } from "./env.js";

/** Relying Party ID for WebAuthn (defaults to request hostname). */
export function webauthnRpId(reqUrl: string, env: AuthPluginEnv): string {
  const fromEnv = env.WEBAUTHN_RP_ID?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return new URL(reqUrl).hostname;
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
  if (host !== "localhost" && host !== "127.0.0.1") {
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
  if (host === "localhost" || host === "127.0.0.1") {
    return ["localhost", "127.0.0.1"];
  }
  return host;
}
