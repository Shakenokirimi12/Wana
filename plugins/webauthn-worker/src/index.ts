import { createAuthPluginApp } from "@wana/auth-plugin-handlers";
import type { AuthPluginEnv } from "@wana/auth-plugin-handlers";

const app = createAuthPluginApp();

export default {
  async fetch(
    request: Request,
    env: AuthPluginEnv,
    ctx: ExecutionContext
  ): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
};
