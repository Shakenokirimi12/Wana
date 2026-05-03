import { createRoute } from "honox/factory";

import { bootstrapUserFromInvite } from "@/data/control-plane";

export const POST = createRoute(async (c) => {
  let body: { token?: string; email?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const email =
    typeof body.email === "string" && body.email.trim()
      ? body.email.trim()
      : undefined;
  if (!token) {
    return c.json({ error: "missing_token" }, 400);
  }

  const result = await bootstrapUserFromInvite(c.env.DB_CONTROL, token, email);
  if (result.ok) {
    return c.json({
      ok: true,
      email: result.email,
      created: result.created,
    });
  }
  return c.json({ ok: false, reason: result.reason }, 400);
});

export default createRoute(async (c) => c.json({ error: "method_not_allowed" }, 405));
