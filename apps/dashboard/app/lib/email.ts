import type { Env } from "../types/bindings";

export type TransactionalEmailInput = {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
};

/**
 * Sends mail via Cloudflare Email Sending (`SEND_MAIL` binding).
 * If the binding or `MAIL_FROM` is missing, logs and returns `{ ok: false }` (local / staging safe).
 */
export async function sendTransactionalEmail(
  env: Env,
  input: TransactionalEmailInput
): Promise<{ ok: boolean; error?: string }> {
  const from = env.MAIL_FROM?.trim();
  if (!env.SEND_MAIL || !from) {
    console.warn(
      "[email] SEND_MAIL binding or MAIL_FROM unset; skip:",
      input.subject
    );
    return { ok: false, error: "email_not_configured" };
  }

  try {
    await env.SEND_MAIL.send({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      replyTo: input.replyTo,
    });
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[email] send failed:", message);
    return { ok: false, error: message };
  }
}
