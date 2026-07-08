import { createMiddleware } from "hono/factory";

import type { Env } from "../types/bindings";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Same-origin guard for state-changing requests (CSRF defense).
 *
 * All mutating routes here are cookie-authenticated form/JSON POSTs. We require
 * the request's Origin (or, if absent, Referer) host to match the target host.
 * A cross-site `<form>`/`fetch` cannot forge a matching Origin, so this blocks
 * CSRF without needing per-form tokens. Safe methods (GET/HEAD) pass through.
 */
export const csrfMiddleware = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    if (!UNSAFE.has(c.req.method)) {
      return next();
    }

    const target = (() => {
      try {
        return new URL(c.req.url).host;
      } catch {
        return null;
      }
    })();

    const sourceHost = (raw: string | undefined): string | null => {
      if (!raw) return null;
      try {
        return new URL(raw).host;
      } catch {
        return null;
      }
    };

    // CLI / SDK requests authenticated via DSN bear `X-Sentry-Auth` (or a
    // Bearer Authorization) and have no Origin / Referer. They authenticate
    // themselves with a shared secret keyed to a single project, so CSRF
    // (which exists to stop a malicious *third-party page* from riding a
    // browser session) doesn't apply — let them pass.
    //
    // Scoped to the one route that actually accepts DSN auth (CLI `wana
    // upload-dif`), and gated on header presence only as a fast pre-check —
    // the route itself re-validates the DSN against the project before doing
    // anything. Every other mutating route stays cookie-session-only and
    // must pass the Origin/Referer check below, so a stray Authorization
    // header can't be used to ride a stolen session cookie cross-site.
    const path = (() => {
      try {
        return new URL(c.req.url).pathname;
      } catch {
        return "";
      }
    })();
    const isDsnAuthRoute = /^\/p\/[^/]+\/debug-files\/?$/.test(path);
    if (isDsnAuthRoute) {
      const sentryAuth = c.req.header("X-Sentry-Auth");
      const authz = c.req.header("Authorization");
      if (sentryAuth || (authz && /^Bearer\s/i.test(authz))) {
        return next();
      }
    }

    const origin = sourceHost(c.req.header("Origin"));
    const referer = sourceHost(c.req.header("Referer"));
    const source = origin ?? referer;

    if (!target || !source || source !== target) {
      return c.json({ error: "cross-origin request blocked" }, 403);
    }

    return next();
  }
);
