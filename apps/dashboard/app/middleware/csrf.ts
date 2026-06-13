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

    const origin = sourceHost(c.req.header("Origin"));
    const referer = sourceHost(c.req.header("Referer"));
    const source = origin ?? referer;

    if (!target || !source || source !== target) {
      return c.json({ error: "cross-origin request blocked" }, 403);
    }

    return next();
  }
);
