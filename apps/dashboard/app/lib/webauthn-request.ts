import type { Context } from "hono";

import type { Env } from "@/types/bindings";

/** Relying Party ID for WebAuthn (defaults to request hostname). */
export function webauthnRpId(c: Context<{ Bindings: Env }>): string {
  const fromEnv = c.env.WEBAUTHN_RP_ID?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return new URL(c.req.url).hostname;
}

/** Origin browsers send in clientDataJSON (defaults to current request origin). */
export function webauthnExpectedOrigin(c: Context<{ Bindings: Env }>): string {
  const fromEnv = c.env.WEBAUTHN_ORIGIN?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  return new URL(c.req.url).origin;
}

/**
 * Verifier origins for WebAuthn. On localhost / 127.0.0.1, accept **both** hostnames with the same
 * port so switching between `http://localhost:*` and `http://127.0.0.1:*` does not fail verification.
 */
export function webauthnExpectedOrigins(
  c: Context<{ Bindings: Env }>
): string | string[] {
  const fromEnv = c.env.WEBAUTHN_ORIGIN?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  const url = new URL(c.req.url);
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

export function webauthnRpName(c: Context<{ Bindings: Env }>): string {
  return c.env.WEBAUTHN_RP_NAME?.trim() || "Wana";
}

/**
 * RP ID(s) for verification. On loopback, accept both `localhost` and `127.0.0.1` (options are still
 * generated with the request hostname only — see `webauthnRpId`).
 */
export function webauthnExpectedRpIds(
  c: Context<{ Bindings: Env }>
): string | string[] {
  const fromEnv = c.env.WEBAUTHN_RP_ID?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const host = new URL(c.req.url).hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return ["localhost", "127.0.0.1"];
  }
  return host;
}
