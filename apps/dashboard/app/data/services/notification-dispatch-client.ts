/**
 * Test-send path used by the Notifications UI. Mirrors the worker's
 * `dispatchTestSend` so the dashboard can fire a webhook directly. Email
 * goes out through the MAIL_SERVICE service binding (the worker's
 * /__internal/send-mail endpoint) since Pages cannot bind SEND_MAIL.
 */

import { and, eq } from "drizzle-orm";

import {
  notificationDeliveries,
  notificationEndpoints,
  projects,
} from "@wana/schema/control-plane";
import {
  buildSignatureHeader,
  deliverWebhook,
  openWebhookSecret,
  signWebhookBody,
} from "@wana/core";

import type { Env } from "@/types/bindings";
import { sendTransactionalEmail } from "@/lib/email";

import { createDb } from "./db-client";

const USER_AGENT = "Wana-Webhook/1 (+https://wana.shakenokiri.me)";
const PAYLOAD_PREVIEW_MAX = 1024;

/**
 * Append `?thread_id=...` to a Discord webhook URL when the endpoint's
 * configJson declares a threadId. Discord's Execute Webhook docs spell
 * out this query-param routing for posting into forum / existing threads.
 * Returns the URL unchanged on malformed config so a typo can't poison
 * the dispatch path.
 */
function withDiscordThreadId(
  rawUrl: string,
  configJson: string | null
): string {
  if (!configJson) return rawUrl;
  try {
    const cfg = JSON.parse(configJson) as { threadId?: unknown };
    if (typeof cfg.threadId !== "string" || !/^\d+$/.test(cfg.threadId)) {
      return rawUrl;
    }
    const u = new URL(rawUrl);
    u.searchParams.set("thread_id", cfg.threadId);
    return u.toString();
  } catch {
    return rawUrl;
  }
}

export async function dispatchTestSend(
  env: Env,
  args: {
    projectId: string;
    endpointId: string;
    triggeredByUserId: string;
  }
): Promise<{
  deliveryId: string;
  status: string;
  responseStatus: number | null;
  errorMessage: string | null;
}> {
  const db = createDb(env.DB_CONTROL);

  const ep = await db
    .select({
      id: notificationEndpoints.id,
      kind: notificationEndpoints.kind,
      target: notificationEndpoints.target,
      secretEnc: notificationEndpoints.secretEnc,
      secretNonce: notificationEndpoints.secretNonce,
      configJson: notificationEndpoints.configJson,
      isActive: notificationEndpoints.isActive,
    })
    .from(notificationEndpoints)
    .where(
      and(
        eq(notificationEndpoints.id, args.endpointId),
        eq(notificationEndpoints.projectId, args.projectId)
      )
    )
    .limit(1);
  if (ep.length === 0) throw new Error("送信先が見つかりません");
  if (!ep[0].isActive) throw new Error("送信先が無効化されています");
  if (ep[0].kind === "webhook" && !env.WEBHOOK_KEK_V1) {
    throw new Error("Webhook KEK が未設定です（管理者に連絡してください）");
  }
  // Slack endpoints need no KEK — the URL itself is the bearer.

  const projectRow = await db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, args.projectId))
    .limit(1);
  const projectName = projectRow[0]?.name ?? args.projectId;

  const deliveryId = `ndv_${crypto.randomUUID().replace(/-/g, "")}`;
  const signedAt = Math.floor(Date.now() / 1000);

  let status: "delivered" | "failed" | "rejected" = "failed";
  let responseStatus: number | null = null;
  let responseMs: number | null = null;
  let errorMessage: string | null = null;
  let payloadPreview = "";

  const started = Date.now();
  if (ep[0].kind === "email") {
    // Pages cannot bind SEND_MAIL — Mail goes through MAIL_SERVICE
    // (service binding → wana-worker /__internal/send-mail) which has
    // SEND_MAIL bound. Same path used by invite emails.
    const subject = `[Wana] テスト通知: ${projectName}`;
    const text =
      `Wana からのテスト通知です。\n` +
      `Project: ${projectName}\n` +
      `Triggered by: ${args.triggeredByUserId}\n` +
      `At (unix): ${signedAt}\n` +
      `\n` +
      `受信できていれば設定は正常です。\n`;
    payloadPreview = subject;
    try {
      const r = await sendTransactionalEmail(env, {
        to: ep[0].target,
        subject,
        text,
      });
      if (r.ok) {
        status = "delivered";
      } else {
        // `email_not_configured` means binding / secret missing — operational,
        // not a recipient-side failure. Surface as "rejected" so the operator
        // can fix Wana's config; other errors are "failed" (remote refused).
        status =
          r.error === "email_not_configured" ? "rejected" : "failed";
        errorMessage = r.error ?? null;
      }
    } catch (e) {
      status = "rejected";
      errorMessage = e instanceof Error ? e.message : "unknown error";
    }
    responseMs = Date.now() - started;
  } else if (ep[0].kind === "discord") {
    // Discord delivery is a plain HTTPS POST. When a thread_id is configured
    // (forum / thread routing) we append it as a query param — Discord's
    // Execute Webhook docs explicitly support thread_id this way.
    const payload = {
      embeds: [
        {
          title: "Wana テスト通知",
          description:
            `**Project:** ${projectName}\n` +
            `**Triggered by:** \`${args.triggeredByUserId}\`\n` +
            `受信できていれば設定は正常です。`,
          color: 0xf59e0b,
        },
      ],
    };
    const bodyJson = JSON.stringify(payload);
    payloadPreview = bodyJson.slice(0, PAYLOAD_PREVIEW_MAX);
    try {
      const targetUrl = withDiscordThreadId(ep[0].target, ep[0].configJson);
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: bodyJson,
        redirect: "manual",
      });
      responseStatus = res.status;
      responseMs = Date.now() - started;
      status =
        res.status >= 200 && res.status < 300 ? "delivered" : "failed";
      if (status !== "delivered") {
        const text = await res.text().catch(() => "");
        errorMessage = text
          ? `Discord: ${text.slice(0, 200)}`
          : `HTTP ${res.status}`;
      }
    } catch (err) {
      status = "rejected";
      errorMessage = err instanceof Error ? err.message : "unknown error";
      responseMs = Date.now() - started;
    }
  } else if (ep[0].kind === "slack") {
    // Slack delivery is a plain HTTPS POST to hooks.slack.com — no
    // KEK/signing needed, so we can fire it directly from Pages.
    const payload = {
      text: `[Wana] テスト通知: ${projectName}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `*[Wana] テスト通知*\n` +
              `Project: *${projectName}*\n` +
              `Triggered by: \`${args.triggeredByUserId}\`\n` +
              `受信できていれば設定は正常です。`,
          },
        },
      ],
    };
    const bodyJson = JSON.stringify(payload);
    payloadPreview = bodyJson.slice(0, PAYLOAD_PREVIEW_MAX);
    try {
      const res = await fetch(ep[0].target, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: bodyJson,
        redirect: "manual",
      });
      responseStatus = res.status;
      responseMs = Date.now() - started;
      status =
        res.status >= 200 && res.status < 300 ? "delivered" : "failed";
      if (status !== "delivered") {
        const text = await res.text().catch(() => "");
        errorMessage = text ? `Slack: ${text.slice(0, 200)}` : `HTTP ${res.status}`;
      }
    } catch (err) {
      status = "rejected";
      errorMessage = err instanceof Error ? err.message : "unknown error";
      responseMs = Date.now() - started;
    }
  } else {
    const body = JSON.stringify({
      version: 1,
      delivery_id: deliveryId,
      event_kind: "test",
      signed_at: signedAt,
      project_id: args.projectId,
      project_name: projectName,
      test: { triggered_by_user_id: args.triggeredByUserId, at: signedAt },
    });
    payloadPreview = body.slice(0, PAYLOAD_PREVIEW_MAX);
    try {
      const secret = await openWebhookSecret(env.WEBHOOK_KEK_V1!, {
        secretEnc: ep[0].secretEnc,
        secretNonce: ep[0].secretNonce,
      });
      const sig = await signWebhookBody(secret, body, signedAt);
      const result = await deliverWebhook({
        url: ep[0].target,
        body,
        signatureHeader: buildSignatureHeader(signedAt, sig),
        userAgent: USER_AGENT,
      });
      responseStatus = result.status;
      responseMs = result.ms;
      errorMessage = result.errorMessage ?? null;
      status =
        result.status >= 200 && result.status < 300 ? "delivered" : "failed";
    } catch (err) {
      status = "rejected";
      errorMessage = err instanceof Error ? err.message : "unknown error";
    }
  }

  const createdAt = new Date();
  await db.insert(notificationDeliveries).values({
    id: deliveryId,
    ruleId: null,
    endpointId: ep[0].id,
    projectId: args.projectId,
    issueId: null,
    eventKind: "test",
    status,
    attempt: 1,
    responseStatus,
    responseMs,
    errorMessage,
    payloadPreview,
    createdAt,
    deliveredAt: status === "delivered" ? createdAt : null,
  });
  return { deliveryId, status, responseStatus, errorMessage };
}
