import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import type { Env } from "@/types/bindings";

/**
 * One-time "just issued this token" flash cookie for /settings/tokens.
 *
 * The POST handler that creates a personal access token redirects (PRG) —
 * it never renders the plain token directly in the POST response, and never
 * puts it in a redirect URL/query string (both would let it linger in
 * browser history, server access logs, or same-origin Referer headers).
 * Instead it's stashed in a short-lived, path-scoped, httpOnly cookie; the
 * following GET reads it once and immediately clears it, so refreshing the
 * page never shows it twice and reloading the *POST* itself creates no new
 * side effect (the create only happens on the POST, which PRG avoids
 * resubmitting).
 */
const FLASH_COOKIE = "wana_pat_flash";
const FLASH_TTL_S = 60;
const TOKEN_RE = /^wana_pat_[a-f0-9]{48}$/;

export function setNewTokenFlash(c: Context<{ Bindings: Env }>, plainToken: string): void {
  if (!TOKEN_RE.test(plainToken)) return;
  setCookie(c, FLASH_COOKIE, plainToken, {
    path: "/settings/tokens",
    httpOnly: true,
    sameSite: "Lax",
    secure: c.req.url.startsWith("https:"),
    maxAge: FLASH_TTL_S,
  });
}

/** Reads and immediately clears the flash cookie — consumable exactly once. */
export function takeNewTokenFlash(c: Context<{ Bindings: Env }>): string | null {
  const v = getCookie(c, FLASH_COOKIE);
  if (!v) return null;
  deleteCookie(c, FLASH_COOKIE, {
    path: "/settings/tokens",
    secure: c.req.url.startsWith("https:"),
  });
  return TOKEN_RE.test(v) ? v : null;
}
