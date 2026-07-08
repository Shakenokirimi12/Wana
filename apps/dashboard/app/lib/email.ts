import type { Env } from "../types/bindings";

export type TransactionalEmailInput = {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
};

/**
 * Send transactional mail by delegating to wana-worker over the
 * MAIL_SERVICE binding. Cloudflare Pages cannot bind SEND_MAIL directly,
 * so all email egress goes through the worker's /__internal/send-mail
 * endpoint, authenticated by the shared INTERNAL_RPC_SECRET header.
 *
 * Returns `{ ok: false, error: "email_not_configured" }` when the binding
 * or secret is missing (local dev / not yet rolled out).
 */
export async function sendTransactionalEmail(
  env: Env,
  input: TransactionalEmailInput
): Promise<{ ok: boolean; error?: string }> {
  if (!env.MAIL_SERVICE || !env.INTERNAL_RPC_SECRET) {
    console.warn(
      "[email] MAIL_SERVICE binding or INTERNAL_RPC_SECRET unset; skip:",
      input.subject
    );
    return { ok: false, error: "email_not_configured" };
  }
  // The worker route accepts a single `to`; collapse arrays for now
  // (matches our current call sites — invite-to-one, notification-to-one).
  const to = Array.isArray(input.to) ? input.to[0] : input.to;
  if (!to) return { ok: false, error: "no_recipient" };
  try {
    const res = await env.MAIL_SERVICE.fetch(
      new Request("https://wana-worker.internal/__internal/send-mail", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-wana-internal-secret": env.INTERNAL_RPC_SECRET,
        },
        body: JSON.stringify({
          to,
          subject: input.subject,
          text: input.text,
          html: input.html,
          replyTo: input.replyTo,
        }),
      })
    );
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    return {
      ok: false,
      error: body?.error ?? `worker_mail_http_${res.status}`,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[email] MAIL_SERVICE fetch failed:", message);
    return { ok: false, error: message };
  }
}
