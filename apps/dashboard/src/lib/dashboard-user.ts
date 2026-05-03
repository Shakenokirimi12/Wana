import type { Env } from "../types/bindings";

/** Resolved control-plane user for dashboard listings (no session auth yet). */
export function dashboardUserId(env: Env): string {
  return env.DASHBOARD_USER_ID?.trim() || "user_01";
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
