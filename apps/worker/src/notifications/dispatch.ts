/**
 * Webhook dispatcher (P1, in-Worker, called from ProjectDataStore.insertEvents
 * via ctx.waitUntil so ingest latency is unaffected). Reads rules from
 * control-plane D1, applies search-grammar filter against the issue + its
 * tag map, throttles via a compare-and-set on `last_fired_at`, signs the
 * payload, posts it through `deliverWebhook` with SSRF + redirect guards,
 * and records each attempt in `notification_deliveries`.
 *
 * "RPC" would be misleading — this is a same-Worker function call.
 */

import { drizzle } from "drizzle-orm/d1";
import { and, eq, sql } from "drizzle-orm";

import {
  notificationDeliveries,
  notificationEndpoints,
  notificationRules,
  projects,
} from "@wana/schema/control-plane";
import {
  buildSignatureHeader,
  deliverWebhook,
  matchIssue,
  openWebhookSecret,
  parseSearchQuery,
  signWebhookBody,
} from "@wana/core";

import type { Env } from "../types";
import type { IssueStatus } from "@wana/types";

const USER_AGENT = "Wana-Webhook/1 (+https://wana.shakenokiri.me)";
const PAYLOAD_PREVIEW_MAX = 1024;

export interface IssueSnapshot {
  id: string;
  type: string;
  value: string;
  culprit: string | null;
  fingerprint: string;
  status: IssueStatus;
  firstSeen: number; // unix ms
  lastSeen: number;  // unix ms
}

export async function dispatchIssueCreated(
  env: Env,
  projectId: string,
  issue: IssueSnapshot,
  tags: Record<string, string>
): Promise<void> {
  // Missing KEK is operational — skip silently so ingest is never blocked.
  if (!env.WEBHOOK_KEK_V1) return;

  const db = drizzle(env.DB_CONTROL);

  // Project name for the payload (and a sanity check that the project exists).
  const projectRow = await db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (projectRow.length === 0) return;
  const projectName = projectRow[0].name;

  const rules = await db
    .select({
      ruleId: notificationRules.id,
      endpointId: notificationRules.endpointId,
      filterQuery: notificationRules.filterQuery,
      minIntervalSeconds: notificationRules.minIntervalSeconds,
      lastFiredAt: notificationRules.lastFiredAt,
      ruleActive: notificationRules.isActive,
      onIssueCreated: notificationRules.onIssueCreated,
      epActive: notificationEndpoints.isActive,
      target: notificationEndpoints.target,
      secretEnc: notificationEndpoints.secretEnc,
      secretNonce: notificationEndpoints.secretNonce,
    })
    .from(notificationRules)
    .innerJoin(
      notificationEndpoints,
      eq(notificationRules.endpointId, notificationEndpoints.id)
    )
    .where(
      and(
        eq(notificationRules.projectId, projectId),
        eq(notificationRules.onIssueCreated, true),
        eq(notificationRules.isActive, true),
        eq(notificationEndpoints.isActive, true)
      )
    );

  if (rules.length === 0) return;

  const issueLike = {
    status: issue.status,
    value: issue.value,
    type: issue.type,
    culprit: issue.culprit,
    eventTagMaps: [tags],
  };

  for (const rule of rules) {
    if (rule.filterQuery && rule.filterQuery.trim()) {
      const q = parseSearchQuery(rule.filterQuery);
      if (!matchIssue(issueLike, q)) continue;
    }

    // Throttle: compare-and-set on last_fired_at. Always update on ATTEMPT
    // (not success) so a misconfigured endpoint can't spam-storm.
    const now = Date.now();
    const cutoff = now - rule.minIntervalSeconds * 1000;
    const upd = await env.DB_CONTROL.prepare(
      "UPDATE notification_rules SET last_fired_at = ?1 WHERE id = ?2 AND (last_fired_at IS NULL OR last_fired_at < ?3)"
    )
      .bind(now, rule.ruleId, cutoff)
      .run();
    if (!upd.meta.changes) continue;

    await fireOne(env, db, {
      projectId,
      projectName,
      rule,
      issue,
      tags,
    });
  }
}

async function fireOne(
  env: Env,
  db: ReturnType<typeof drizzle>,
  args: {
    projectId: string;
    projectName: string;
    rule: {
      ruleId: string;
      endpointId: string;
      target: string;
      secretEnc: string;
      secretNonce: string;
    };
    issue: IssueSnapshot;
    tags: Record<string, string>;
  }
): Promise<void> {
  const deliveryId = `ndv_${crypto.randomUUID().replace(/-/g, "")}`;
  const signedAt = Math.floor(Date.now() / 1000);
  const dashboardBase = env.DASHBOARD_PUBLIC_URL?.replace(/\/$/, "") ?? "";
  const dashboardUrl = dashboardBase
    ? `${dashboardBase}/p/${encodeURIComponent(args.projectId)}/issues/${encodeURIComponent(args.issue.id)}`
    : null;

  const body = JSON.stringify({
    version: 1,
    delivery_id: deliveryId,
    event_kind: "issue.created",
    signed_at: signedAt,
    project_id: args.projectId,
    project_name: args.projectName,
    issue: {
      id: args.issue.id,
      type: args.issue.type,
      value: args.issue.value,
      culprit: args.issue.culprit,
      fingerprint: args.issue.fingerprint,
      first_seen: Math.floor(args.issue.firstSeen / 1000),
      last_seen: Math.floor(args.issue.lastSeen / 1000),
      tags: args.tags,
    },
    dashboard_url: dashboardUrl,
  });

  let status: "delivered" | "failed" | "rejected" = "failed";
  let responseStatus: number | null = null;
  let responseMs: number | null = null;
  let errorMessage: string | null = null;

  try {
    const secret = await openWebhookSecret(env.WEBHOOK_KEK_V1!, {
      secretEnc: args.rule.secretEnc,
      secretNonce: args.rule.secretNonce,
    });
    const sig = await signWebhookBody(secret, body, signedAt);
    const result = await deliverWebhook({
      url: args.rule.target,
      body,
      signatureHeader: buildSignatureHeader(signedAt, sig),
      userAgent: USER_AGENT,
    });
    responseStatus = result.status;
    responseMs = result.ms;
    errorMessage = result.errorMessage ?? null;
    if (result.status >= 200 && result.status < 300) status = "delivered";
    else if (result.status === 0) status = "failed";
    else status = "failed";
  } catch (err) {
    status = "rejected";
    errorMessage = err instanceof Error ? err.message : "unknown error";
  }

  const createdAt = new Date();
  const deliveredAt = status === "delivered" ? createdAt : null;
  await db.insert(notificationDeliveries).values({
    id: deliveryId,
    ruleId: args.rule.ruleId,
    endpointId: args.rule.endpointId,
    projectId: args.projectId,
    issueId: args.issue.id,
    eventKind: "issue.created",
    status,
    attempt: 1,
    responseStatus,
    responseMs,
    errorMessage,
    payloadPreview: body.slice(0, PAYLOAD_PREVIEW_MAX),
    createdAt,
    deliveredAt,
  });
}

/** Operator-initiated test send (no rule throttle). */
export async function dispatchTestSend(
  env: Env,
  args: {
    projectId: string;
    endpointId: string;
    triggeredByUserId: string;
  }
): Promise<{ deliveryId: string; status: string; responseStatus: number | null; errorMessage: string | null }> {
  if (!env.WEBHOOK_KEK_V1) throw new Error("Webhook KEK が未設定です");
  const db = drizzle(env.DB_CONTROL);
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

/**
 * Run a sql-bound `UPDATE` with returning() against drizzle, used for the
 * compare-and-set throttle. (sql import is here so the linter doesn't strip it.)
 */
const _keepSqlImport = sql;
void _keepSqlImport;
