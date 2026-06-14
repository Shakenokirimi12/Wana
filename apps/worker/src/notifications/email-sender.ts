/**
 * Send a transactional email via Cloudflare Email Sending. The worker's
 * `SEND_MAIL` binding is configured in wrangler.jsonc with `send_email`. If
 * the binding or `MAIL_FROM` is missing, returns `{ ok: false }` instead of
 * throwing so the caller can record a graceful "rejected" delivery.
 */

import { EmailMessage } from "cloudflare:email";

interface EmailEnv {
  SEND_MAIL?: { send(message: EmailMessage): Promise<void> };
  MAIL_FROM?: string;
}

const SUBJECT_RE = /[^\x20-\x7E]/; // any non-ASCII char triggers MIME-encoded-word

function encodeSubject(subject: string): string {
  if (!SUBJECT_RE.test(subject)) return subject;
  // RFC 2047 encoded-word, base64 UTF-8.
  const utf8 = unescape(encodeURIComponent(subject));
  let b64 = "";
  for (let i = 0; i < utf8.length; i++) b64 += String.fromCharCode(utf8.charCodeAt(i));
  return `=?UTF-8?B?${btoa(b64)}?=`;
}

function buildRawEmail(opts: {
  from: string;
  to: string;
  subject: string;
  text: string;
}): string {
  return [
    `From: Wana <${opts.from}>`,
    `To: ${opts.to}`,
    `Subject: ${encodeSubject(opts.subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="utf-8"`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    opts.text,
  ].join("\r\n");
}

export async function sendNotificationEmail(
  env: EmailEnv,
  opts: { to: string; subject: string; text: string }
): Promise<{ ok: boolean; error?: string }> {
  if (!env.SEND_MAIL || !env.MAIL_FROM) {
    return { ok: false, error: "email_not_configured" };
  }
  try {
    const raw = buildRawEmail({
      from: env.MAIL_FROM,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
    });
    const message = new EmailMessage(env.MAIL_FROM, opts.to, raw);
    await env.SEND_MAIL.send(message);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}
