import type { Context } from "hono";

import type { Env } from "../types/bindings";

/** Matches session middleware: env fallback is only for local / staging. */
export function isDashboardDevFallback(env: Env): boolean {
  const v = env.DASHBOARD_DEV_FALLBACK;
  return v === "true" || v === "1";
}

/** Email-based passkey enrollment without prior session (dev / controlled rollout only). */
export function isWebAuthnEmailEnrollmentEnabled(env: Env): boolean {
  const v = env.WEBAUTHN_ALLOW_EMAIL_ENROLLMENT;
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
