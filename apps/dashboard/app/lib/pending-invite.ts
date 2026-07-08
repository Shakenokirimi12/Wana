import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import type { Env } from "@/types/bindings";

/**
 * "Pending invite" cookie — remembers the invite token across browser
 * navigation so a user who clicks an invite email then closes the tab
 * (or wanders away to log in by typing /login directly) still lands on
 * the right /invite/[token] page after auth completes.
 *
 * Stored unencrypted because the token is already a bearer credential
 * sent via email; the cookie is just a UX convenience.
 */
export const PENDING_INVITE_COOKIE = "wana_pending_invite";

/** 7 days — long enough to survive a forgotten tab + weekend gap. */
const PENDING_INVITE_TTL_S = 7 * 24 * 60 * 60;

/**
 * Looser than full token validation: just an opaque whitelist of safe
 * URL characters so we never feed something dangerous back into a path
 * or query string.
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,200}$/;

export function setPendingInviteCookie(
  c: Context<{ Bindings: Env }>,
  token: string
): void {
  if (!TOKEN_RE.test(token)) return;
  const secure = c.req.url.startsWith("https:");
  setCookie(c, PENDING_INVITE_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure,
    maxAge: PENDING_INVITE_TTL_S,
  });
}

export function getPendingInviteCookie(
  c: Context<{ Bindings: Env }>
): string | null {
  const v = getCookie(c, PENDING_INVITE_COOKIE);
  if (!v || !TOKEN_RE.test(v)) return null;
  return v;
}

export function clearPendingInviteCookie(
  c: Context<{ Bindings: Env }>
): void {
  const secure = c.req.url.startsWith("https:");
  deleteCookie(c, PENDING_INVITE_COOKIE, {
    path: "/",
    secure,
  });
}

/**
 * Compose a `next` URL for login/signup using the cookie token when no
 * explicit `next` was passed. The path is built without `encodeURIComponent`
 * on `next` because the caller (login/signup link generators) handles
 * URL-encoding themselves.
 */
export function pendingInviteNextPath(
  c: Context<{ Bindings: Env }>
): string | null {
  const t = getPendingInviteCookie(c);
  return t ? `/invite/${encodeURIComponent(t)}` : null;
}
