/**
 * Test-send path used by the Notifications UI. Mirrors the worker's
 * `dispatchTestSend` so the dashboard can fire a webhook directly without
 * a cross-script service binding. Production deliveries (issue.created)
 * still come from the worker.
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

import { createDb } from "./db-client";

const USER_AGENT = "Wana-Webhook/1 (+https://wana.shakenokiri.me)";
const PAYLOAD_PREVIEW_MAX = 1024;

interface DispatchEnv {
  DB_CONTROL: D1Database;
  WEBHOOK_KEK_V1?: string;
}

export async function dispatchTestSend(
  env: DispatchEnv,
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
  if (!env.WEBHOOK_KEK_V1) {
    throw new Error("Webhook KEK が未設定です（管理者に連絡してください）");
  }
  const db = createDb(env.DB_CONTROL);

  const ep = await db
    .select({
      id: notificationEndpoints.id,
      target: notificationEndpoints.target,
      secretEnc: notificationEndpoints.secretEnc,
      secretNonce: notificationEndpoints.secretNonce,
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

  const projectRow = await db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, args.projectId))
    .limit(1);
  const projectName = projectRow[0]?.name ?? args.projectId;

  const deliveryId = `ndv_${crypto.randomUUID().replace(/-/g, "")}`;
  const signedAt = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    version: 1,
    delivery_id: deliveryId,
    event_kind: "test",
    signed_at: signedAt,
    project_id: args.projectId,
    project_name: projectName,
    test: { triggered_by_user_id: args.triggeredByUserId, at: signedAt },
  });

  let status: "delivered" | "failed" | "rejected" = "failed";
  let responseStatus: number | null = null;
  let responseMs: number | null = null;
  let errorMessage: string | null = null;

  try {
    const secret = await openWebhookSecret(env.WEBHOOK_KEK_V1, {
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
    payloadPreview: body.slice(0, PAYLOAD_PREVIEW_MAX),
    createdAt,
    deliveredAt: status === "delivered" ? createdAt : null,
  });
  return { deliveryId, status, responseStatus, errorMessage };
}
