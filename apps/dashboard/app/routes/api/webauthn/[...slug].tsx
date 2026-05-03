import type { Context } from "hono";
import { createRoute } from "honox/factory";

import { createAuthPluginApp } from "@wana/auth-plugin-handlers";

import type { Env } from "@/types/bindings";

const authPluginApp = createAuthPluginApp();

async function dispatch(c: Context<{ Bindings: Env }>) {
  if (c.env.AUTH_PLUGIN) {
    return c.env.AUTH_PLUGIN.fetch(c.req.raw);
  }
  return authPluginApp.fetch(c.req.raw, c.env);
}

export const GET = createRoute(dispatch);
export const POST = createRoute(dispatch);
export const PUT = createRoute(dispatch);
export const PATCH = createRoute(dispatch);
export const DELETE = createRoute(dispatch);

export default createRoute(dispatch);
