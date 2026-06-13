import type { Context } from "hono";

import type { Env } from "../types/bindings";

/** True only for loopback hosts (local dev). Used to fence off dev-only auth. */
export function isLoopbackHost(host: string): boolean {
  const h = host.replace(/:\d+$/, "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
}

/**
 * Matches session middleware: env fallback is only for local dev.
 * Hardened — even if `DASHBOARD_DEV_FALLBACK` is left "true" in a deployed
 * config, it is IGNORED unless the request host is loopback. This prevents the
 * "anyone with no cookie is user_01" auth bypass on a real domain.
 */
export function isDashboardDevFallback(
  env: Env,
  c?: Context<{ Bindings: Env }>
): boolean {
  const v = env.DASHBOARD_DEV_FALLBACK;
  if (!(v === "true" || v === "1")) return false;
  if (!c) return false;
  try {
    return isLoopbackHost(new URL(c.req.url).host);
  } catch {
    return false;
  }
}

/** Email-based passkey enrollment without prior session (dev / controlled rollout only). */
export function isWebAuthnEmailEnrollmentEnabled(env: Env): boolean {
  const v = env.WEBAUTHN_ALLOW_EMAIL_ENROLLMENT;
  return v === "true" || v === "1";
}

/** Open self-service signup (anyone can create an account). Default off. */
export function isOpenSignupEnabled(env: Env): boolean {
  const v = env.ALLOW_OPEN_SIGNUP;
  return v === "true" || v === "1";
}

/** Resolved user id from session middleware, or null. */
export function getDashboardUserId(
  c: Context<{ Bindings: Env }>
): string | null {
  const v = c.get("dashboardUserId");
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Active team org id (Slack-style), or null. */
export function getActiveOrgId(c: Context<{ Bindings: Env }>): string | null {
  const v = c.get("activeOrgId");
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function ingestPublicOrigin(env: Env): string {
  const raw = env.INGEST_PUBLIC_URL?.trim();
  if (raw) {
    return raw.replace(/\/$/, "");
  }
  return "http://127.0.0.1:8787";
}

export function playgroundHref(env: Env): string | undefined {
  const u = env.SENTRY_PLAYGROUND_URL?.trim();
  return u || undefined;
}
