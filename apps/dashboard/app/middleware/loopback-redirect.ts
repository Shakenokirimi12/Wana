import { createMiddleware } from "hono/factory";

import type { Env } from "@/types/bindings";

/**
 * WebAuthn / rpId は `127.0.0.1` を不正ドメインとして拒むことがあります。
 * ローカル HTTP(S) のみ、`localhost`（同一ポート・パス・クエリ）へリダイレクトします。
 */
export const loopbackRedirectMiddleware = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const disable =
      c.env.DASHBOARD_DISABLE_LOOPBACK_REDIRECT === "true" ||
      c.env.DASHBOARD_DISABLE_LOOPBACK_REDIRECT === "1";
    if (disable) {
      await next();
      return;
    }

    const url = new URL(c.req.url);
    if (url.hostname !== "127.0.0.1") {
      await next();
      return;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      await next();
      return;
    }

    const port = url.port;
    const host = port ? `localhost:${port}` : "localhost";
    const dest = `${url.protocol}//${host}${url.pathname}${url.search}`;
    return c.redirect(dest, 302);
  }
);
