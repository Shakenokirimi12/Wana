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
  organizations,
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
import { sendNotificationEmail } from "./email-sender";

const USER_AGENT = "Wana-Webhook/1 (+https://wana.shakenokiri.me)";
const PAYLOAD_PREVIEW_MAX = 1024;
const CHAT_WEBHOOK_TIMEOUT_MS = 8_000;

interface ChatWebhookResult {
  status: "delivered" | "failed" | "rejected";
  responseStatus: number | null;
  responseMs: number;
  errorMessage: string | null;
}

/**
 * POST a JSON payload to a Slack/Discord-style incoming webhook with a hard
 * timeout (mirrors deliverWebhook's guard against a hung generic-webhook
 * endpoint — without it a slow chat endpoint hangs the ctx.waitUntil
 * dispatch task indefinitely) and classify the response into a delivery
 * status. Callers record the notification_deliveries row themselves since
 * the known columns (ruleId, issueId, eventKind, ...) differ per call site.
 */
async function postChatWebhook(
  url: string,
  body: string,
  label: "Slack" | "Discord"
): Promise<ChatWebhookResult> {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CHAT_WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": USER_AGENT,
      },
      body,
      redirect: "manual",
      signal: ac.signal,
    });
    const responseMs = Date.now() - started;
    if (res.status >= 200 && res.status < 300) {
      return {
        status: "delivered",
        responseStatus: res.status,
        responseMs,
        errorMessage: null,
      };
    }
    const text = await res.text().catch(() => "");
    return {
      status: "failed",
      responseStatus: res.status,
      responseMs,
      errorMessage: text ? `${label}: ${text.slice(0, 200)}` : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      status: "rejected",
      responseStatus: null,
      responseMs: Date.now() - started,
      errorMessage: err instanceof Error ? err.message : "unknown error",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Append `?thread_id=...` to a Discord webhook URL when the endpoint has a
 * thread_id configured. See Discord's Execute Webhook docs — this query
 * param routes the message into a specific thread inside the channel the
 * webhook is bound to. Falls back to the raw URL on malformed config.
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

export interface IssueSnapshot {
  id: string;
  type: string;
  value: string;
  culprit: string | null;
  fingerprint: string;
  status: IssueStatus;
  firstSeen: number; // unix ms
  lastSeen: number;  // unix ms
  assigneeUserId: string | null;
}

export async function dispatchIssueCreated(
  env: Env,
  projectId: string,
  issue: IssueSnapshot,
  tags: Record<string, string>
): Promise<void> {
  // Webhook KEK is required for webhook endpoints; email endpoints don't need
  // it. We continue with email-only rules even if KEK is missing.

  const db = drizzle(env.DB_CONTROL);

  // Project name for the payload + the org's feature flag so we can drop
  // email-kind rules if the org isn't licensed for email anymore.
  const projectRow = await db
    .select({
      name: projects.name,
      emailFlag: organizations.featuresEmailNotifications,
    })
    .from(projects)
    .innerJoin(organizations, eq(projects.orgId, organizations.id))
    .where(eq(projects.id, projectId))
    .limit(1);
  if (projectRow.length === 0) return;
  const projectName = projectRow[0].name;
  const orgEmailEnabled = projectRow[0].emailFlag === true;

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
      kind: notificationEndpoints.kind,
      target: notificationEndpoints.target,
      secretEnc: notificationEndpoints.secretEnc,
      secretNonce: notificationEndpoints.secretNonce,
      configJson: notificationEndpoints.configJson,
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
    assigneeUserId: issue.assigneeUserId,
  };

  for (const rule of rules) {
    // Skip email rules when the org's plan flag is off — a license expiry or
    // a downgrade between rule creation and fire time should not leak mail.
    if (rule.kind === "email" && !orgEmailEnabled) continue;
    // Skip webhook rules when KEK is unset (operational hard-stop).
    if (rule.kind === "webhook" && !env.WEBHOOK_KEK_V1) continue;

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

    if (rule.kind === "email") {
      await fireEmail(env, db, {
        projectId,
        projectName,
        rule,
        issue,
        tags,
      });
    } else if (rule.kind === "slack") {
      await fireSlack(env, db, {
        projectId,
        projectName,
        rule,
        issue,
        tags,
      });
    } else if (rule.kind === "discord") {
      await fireDiscord(env, db, {
        projectId,
        projectName,
        rule,
        issue,
        tags,
      });
    } else {
      await fireOne(env, db, {
        projectId,
        projectName,
        rule,
        issue,
        tags,
      });
    }
  }
}

/**
 * Slack delivery payload. Slack Block Kit produces a card-style message
 * with the issue type/value, optional culprit, top tags, and a "View in
 * Wana" button. Truncates tags so the payload stays comfortably under
 * Slack's 50-block limit.
 */
function buildSlackIssuePayload(args: {
  projectName: string;
  issue: IssueSnapshot;
  tags: Record<string, string>;
  dashboardUrl: string | null;
}): unknown {
  const tagEntries = Object.entries(args.tags).slice(0, 10);
  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `🚨 ${args.projectName}: ${args.issue.type}`.slice(0, 150),
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${truncateMrkdwn(args.issue.value, 500)}*`,
      },
    },
  ];
  if (args.issue.culprit) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Culprit: \`${truncateMrkdwn(args.issue.culprit, 200)}\``,
        },
      ],
    });
  }
  if (tagEntries.length > 0) {
    blocks.push({
      type: "section",
      fields: tagEntries.map(([k, v]) => ({
        type: "mrkdwn",
        text: `*${k}:*\n${truncateMrkdwn(String(v), 100)}`,
      })),
    });
  }
  if (args.dashboardUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View in Wana" },
          url: args.dashboardUrl,
          style: "primary",
        },
      ],
    });
  }
  return {
    text: `[Wana] ${args.projectName}: ${args.issue.type} — ${args.issue.value}`.slice(
      0,
      250
    ),
    blocks,
  };
}

function truncateMrkdwn(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function buildDiscordIssuePayload(args: {
  projectName: string;
  issue: IssueSnapshot;
  tags: Record<string, string>;
  dashboardUrl: string | null;
}): unknown {
  const tagEntries = Object.entries(args.tags).slice(0, 10);
  const description =
    `\`${args.issue.type}\`\n` +
    `${truncateMrkdwn(args.issue.value, 800)}` +
    (args.issue.culprit
      ? `\n\n**Culprit**: \`${truncateMrkdwn(args.issue.culprit, 200)}\``
      : "");
  const fields = tagEntries.map(([k, v]) => ({
    name: k,
    value: truncateMrkdwn(String(v), 200),
    inline: true,
  }));
  // 0xef4444 → tailwind rose-500; consistent with "alert" theme.
  // No top-level `content`: the embed title carries the heading. Sending
  // both produces a redundant "[Wana] X: Y" line above the card.
  return {
    embeds: [
      {
        title: `🚨 ${args.projectName}: ${args.issue.type}`.slice(0, 256),
        url: args.dashboardUrl ?? undefined,
        description,
        color: 0xef4444,
        fields,
        timestamp: new Date(args.issue.lastSeen).toISOString(),
      },
    ],
  };
}

async function fireDiscord(
  env: Env,
  db: ReturnType<typeof drizzle>,
  args: {
    projectId: string;
    projectName: string;
    rule: {
      ruleId: string;
      endpointId: string;
      target: string;
      configJson: string | null;
    };
    issue: IssueSnapshot;
    tags: Record<string, string>;
  }
): Promise<void> {
  const deliveryId = `ndv_${crypto.randomUUID().replace(/-/g, "")}`;
  const dashboardBase = env.DASHBOARD_PUBLIC_URL?.replace(/\/$/, "") ?? "";
  const dashboardUrl = dashboardBase
    ? `${dashboardBase}/p/${encodeURIComponent(args.projectId)}/issues/${encodeURIComponent(args.issue.id)}`
    : null;
  const payload = buildDiscordIssuePayload({
    projectName: args.projectName,
    issue: args.issue,
    tags: args.tags,
    dashboardUrl,
  });
  const body = JSON.stringify(payload);

  const targetUrl = withDiscordThreadId(args.rule.target, args.rule.configJson);
  const { status, responseStatus, responseMs, errorMessage } =
    await postChatWebhook(targetUrl, body, "Discord");

  const createdAt = new Date();
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
    deliveredAt: status === "delivered" ? createdAt : null,
  });
}

async function fireSlack(
  env: Env,
  db: ReturnType<typeof drizzle>,
  args: {
    projectId: string;
    projectName: string;
    rule: {
      ruleId: string;
      endpointId: string;
      target: string;
    };
    issue: IssueSnapshot;
    tags: Record<string, string>;
  }
): Promise<void> {
  const deliveryId = `ndv_${crypto.randomUUID().replace(/-/g, "")}`;
  const dashboardBase = env.DASHBOARD_PUBLIC_URL?.replace(/\/$/, "") ?? "";
  const dashboardUrl = dashboardBase
    ? `${dashboardBase}/p/${encodeURIComponent(args.projectId)}/issues/${encodeURIComponent(args.issue.id)}`
    : null;

  const payload = buildSlackIssuePayload({
    projectName: args.projectName,
    issue: args.issue,
    tags: args.tags,
    dashboardUrl,
  });
  const body = JSON.stringify(payload);

  const { status, responseStatus, responseMs, errorMessage } =
    await postChatWebhook(args.rule.target, body, "Slack");

  const createdAt = new Date();
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
    deliveredAt: status === "delivered" ? createdAt : null,
  });
}

function buildIssueEmailText(args: {
  projectName: string;
  issue: IssueSnapshot;
  tags: Record<string, string>;
  dashboardUrl: string | null;
}): { subject: string; text: string } {
  const tagLines = Object.entries(args.tags)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n");
  const subject = `[Wana] ${args.projectName}: ${args.issue.type} — ${args.issue.value}`.slice(
    0,
    250
  );
  const text =
    `${args.issue.type}: ${args.issue.value}\n` +
    (args.issue.culprit ? `Culprit: ${args.issue.culprit}\n` : "") +
    `Project: ${args.projectName}\n` +
    (tagLines ? `\nTags:\n${tagLines}\n` : "") +
    (args.dashboardUrl ? `\n${args.dashboardUrl}\n` : "") +
    `\n— Wana\n`;
  return { subject, text };
}

async function fireEmail(
  env: Env,
  db: ReturnType<typeof drizzle>,
  args: {
    projectId: string;
    projectName: string;
    rule: {
      ruleId: string;
      endpointId: string;
      target: string;
    };
    issue: IssueSnapshot;
    tags: Record<string, string>;
  }
): Promise<void> {
  const deliveryId = `ndv_${crypto.randomUUID().replace(/-/g, "")}`;
  const dashboardBase = env.DASHBOARD_PUBLIC_URL?.replace(/\/$/, "") ?? "";
  const dashboardUrl = dashboardBase
    ? `${dashboardBase}/p/${encodeURIComponent(args.projectId)}/issues/${encodeURIComponent(args.issue.id)}`
    : null;
  const { subject, text } = buildIssueEmailText({
    projectName: args.projectName,
    issue: args.issue,
    tags: args.tags,
    dashboardUrl,
  });

  let status: "delivered" | "failed" | "rejected" = "failed";
  let errorMessage: string | null = null;

  const started = Date.now();
  try {
    const res = await sendNotificationEmail(env, {
      to: args.rule.target,
      subject,
      text,
    });
    if (res.ok) {
      status = "delivered";
    } else {
      status = res.error === "email_not_configured" ? "rejected" : "failed";
      errorMessage = res.error ?? null;
    }
  } catch (e) {
    status = "rejected";
    errorMessage = e instanceof Error ? e.message : "unknown error";
  }
  const responseMs = Date.now() - started;

  const createdAt = new Date();
  await db.insert(notificationDeliveries).values({
    id: deliveryId,
    ruleId: args.rule.ruleId,
    endpointId: args.rule.endpointId,
    projectId: args.projectId,
    issueId: args.issue.id,
    eventKind: "issue.created",
    status,
    attempt: 1,
    responseStatus: null,
    responseMs,
    errorMessage,
    payloadPreview: subject.slice(0, PAYLOAD_PREVIEW_MAX),
    createdAt,
    deliveredAt: status === "delivered" ? createdAt : null,
  });
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

/**
 * Fire issue.resolved / issue.regressed notifications. Uses the same rule
 * table as issue.created but selects on a different "on_*" column.
 * Payloads are intentionally lighter than the full incident card — these
 * are status updates, not first alerts.
 */
export async function dispatchIssueStatusChange(
  env: Env,
  projectId: string,
  issue: IssueSnapshot,
  tags: Record<string, string>,
  changeKind: "resolved" | "regressed"
): Promise<void> {
  const db = drizzle(env.DB_CONTROL);

  const projectRow = await db
    .select({
      name: projects.name,
      emailFlag: organizations.featuresEmailNotifications,
    })
    .from(projects)
    .innerJoin(organizations, eq(projects.orgId, organizations.id))
    .where(eq(projects.id, projectId))
    .limit(1);
  if (projectRow.length === 0) return;
  const projectName = projectRow[0].name;
  const orgEmailEnabled = projectRow[0].emailFlag === true;

  const onColumn =
    changeKind === "resolved"
      ? notificationRules.onIssueResolved
      : notificationRules.onIssueRegressed;
  const rules = await db
    .select({
      ruleId: notificationRules.id,
      endpointId: notificationRules.endpointId,
      filterQuery: notificationRules.filterQuery,
      minIntervalSeconds: notificationRules.minIntervalSeconds,
      lastFiredAt: notificationRules.lastFiredAt,
      ruleActive: notificationRules.isActive,
      epActive: notificationEndpoints.isActive,
      kind: notificationEndpoints.kind,
      target: notificationEndpoints.target,
      secretEnc: notificationEndpoints.secretEnc,
      secretNonce: notificationEndpoints.secretNonce,
      configJson: notificationEndpoints.configJson,
    })
    .from(notificationRules)
    .innerJoin(
      notificationEndpoints,
      eq(notificationRules.endpointId, notificationEndpoints.id)
    )
    .where(
      and(
        eq(notificationRules.projectId, projectId),
        eq(onColumn, true),
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
    assigneeUserId: issue.assigneeUserId,
  };

  for (const rule of rules) {
    if (rule.kind === "email" && !orgEmailEnabled) continue;
    if (rule.kind === "webhook" && !env.WEBHOOK_KEK_V1) continue;
    if (rule.filterQuery && rule.filterQuery.trim()) {
      const q = parseSearchQuery(rule.filterQuery);
      if (!matchIssue(issueLike, q)) continue;
    }
    const now = Date.now();
    const cutoff = now - rule.minIntervalSeconds * 1000;
    const upd = await env.DB_CONTROL.prepare(
      "UPDATE notification_rules SET last_fired_at = ?1 WHERE id = ?2 AND (last_fired_at IS NULL OR last_fired_at < ?3)"
    )
      .bind(now, rule.ruleId, cutoff)
      .run();
    if (!upd.meta.changes) continue;

    await fireStatusChange(env, db, {
      projectId,
      projectName,
      rule,
      issue,
      tags,
      changeKind,
    });
  }
}

/**
 * Single fire helper for status-change events. Lighter payloads than the
 * issue.created flow — just enough so a humanreceiving the notification
 * knows what changed.
 */
async function fireStatusChange(
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
      kind: string;
      configJson: string | null;
    };
    issue: IssueSnapshot;
    tags: Record<string, string>;
    changeKind: "resolved" | "regressed";
  }
): Promise<void> {
  const eventKind =
    args.changeKind === "resolved" ? "issue.resolved" : "issue.regressed";
  const deliveryId = `ndv_${crypto.randomUUID().replace(/-/g, "")}`;
  const dashboardBase = env.DASHBOARD_PUBLIC_URL?.replace(/\/$/, "") ?? "";
  const dashboardUrl = dashboardBase
    ? `${dashboardBase}/p/${encodeURIComponent(args.projectId)}/issues/${encodeURIComponent(args.issue.id)}`
    : null;
  const verb = args.changeKind === "resolved" ? "Resolved" : "Regressed";
  const icon = args.changeKind === "resolved" ? "✅" : "⚠️";
  const heading = `${icon} ${verb}: ${args.projectName}`;
  const bodyLine = `${args.issue.type}: ${args.issue.value}`;

  let status: "delivered" | "failed" | "rejected" = "failed";
  let responseStatus: number | null = null;
  let responseMs: number | null = null;
  let errorMessage: string | null = null;
  let payloadPreview = "";

  const started = Date.now();
  try {
    if (args.rule.kind === "email") {
      const subject = `[Wana ${verb}] ${args.projectName}: ${args.issue.type}`.slice(0, 250);
      const text =
        `${heading}\n\n` +
        `${bodyLine}\n` +
        (args.issue.culprit ? `Culprit: ${args.issue.culprit}\n` : "") +
        (dashboardUrl ? `\n${dashboardUrl}\n` : "") +
        `\n— Wana\n`;
      payloadPreview = subject;
      const r = await sendNotificationEmail(env, {
        to: args.rule.target,
        subject,
        text,
      });
      if (r.ok) status = "delivered";
      else {
        status = r.error === "email_not_configured" ? "rejected" : "failed";
        errorMessage = r.error ?? null;
      }
    } else if (args.rule.kind === "slack") {
      const payload = {
        text: `${heading} — ${bodyLine}`,
      };
      const slackBody = JSON.stringify(payload);
      payloadPreview = slackBody.slice(0, PAYLOAD_PREVIEW_MAX);
      const r = await postChatWebhook(args.rule.target, slackBody, "Slack");
      status = r.status;
      responseStatus = r.responseStatus;
      errorMessage = r.errorMessage;
    } else if (args.rule.kind === "discord") {
      const payload = {
        content: `${heading}`,
        embeds: [
          {
            description:
              `\`${args.issue.type}\`\n${truncateMrkdwn(args.issue.value, 600)}`,
            color: args.changeKind === "resolved" ? 0x10b981 : 0xf59e0b,
            url: dashboardUrl ?? undefined,
          },
        ],
      };
      const discordBody = JSON.stringify(payload);
      payloadPreview = discordBody.slice(0, PAYLOAD_PREVIEW_MAX);
      const targetUrl = withDiscordThreadId(args.rule.target, args.rule.configJson);
      const r = await postChatWebhook(targetUrl, discordBody, "Discord");
      status = r.status;
      responseStatus = r.responseStatus;
      errorMessage = r.errorMessage;
    } else {
      // Generic webhook — same envelope shape as issue.created, just with
      // a different event_kind so receivers can branch.
      const signedAt = Math.floor(Date.now() / 1000);
      const body = JSON.stringify({
        version: 1,
        delivery_id: deliveryId,
        event_kind: eventKind,
        signed_at: signedAt,
        project_id: args.projectId,
        project_name: args.projectName,
        issue: {
          id: args.issue.id,
          type: args.issue.type,
          value: args.issue.value,
          culprit: args.issue.culprit,
          fingerprint: args.issue.fingerprint,
          status: args.issue.status,
          first_seen: Math.floor(args.issue.firstSeen / 1000),
          last_seen: Math.floor(args.issue.lastSeen / 1000),
          tags: args.tags,
        },
        dashboard_url: dashboardUrl,
      });
      payloadPreview = body.slice(0, PAYLOAD_PREVIEW_MAX);
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
      errorMessage = result.errorMessage ?? null;
      status =
        result.status >= 200 && result.status < 300 ? "delivered" : "failed";
    }
  } catch (err) {
    status = "rejected";
    errorMessage = err instanceof Error ? err.message : "unknown error";
  }
  responseMs = Date.now() - started;

  const createdAt = new Date();
  await db.insert(notificationDeliveries).values({
    id: deliveryId,
    ruleId: args.rule.ruleId,
    endpointId: args.rule.endpointId,
    projectId: args.projectId,
    issueId: args.issue.id,
    eventKind,
    status,
    attempt: 1,
    responseStatus,
    responseMs,
    errorMessage,
    payloadPreview,
    createdAt,
    deliveredAt: status === "delivered" ? createdAt : null,
  });
}

/**
 * Spike notification. Triggered by ProjectDataStore.maybeDispatchSpikes
 * when an issue's last-5min rate jumps materially above its prior 25-min
 * baseline. Reuses the issue-status-change fire path so all four channels
 * (webhook/email/slack/discord) get a lightweight "spike" payload.
 */
export async function dispatchIssueSpike(
  env: Env,
  projectId: string,
  issue: IssueSnapshot,
  tags: Record<string, string>,
  spike: { recent5min: number; baseline25min: number }
): Promise<void> {
  const db = drizzle(env.DB_CONTROL);

  const projectRow = await db
    .select({
      name: projects.name,
      emailFlag: organizations.featuresEmailNotifications,
    })
    .from(projects)
    .innerJoin(organizations, eq(projects.orgId, organizations.id))
    .where(eq(projects.id, projectId))
    .limit(1);
  if (projectRow.length === 0) return;
  const projectName = projectRow[0].name;
  const orgEmailEnabled = projectRow[0].emailFlag === true;

  const rules = await db
    .select({
      ruleId: notificationRules.id,
      endpointId: notificationRules.endpointId,
      filterQuery: notificationRules.filterQuery,
      minIntervalSeconds: notificationRules.minIntervalSeconds,
      lastFiredAt: notificationRules.lastFiredAt,
      ruleActive: notificationRules.isActive,
      epActive: notificationEndpoints.isActive,
      kind: notificationEndpoints.kind,
      target: notificationEndpoints.target,
      secretEnc: notificationEndpoints.secretEnc,
      secretNonce: notificationEndpoints.secretNonce,
      configJson: notificationEndpoints.configJson,
    })
    .from(notificationRules)
    .innerJoin(
      notificationEndpoints,
      eq(notificationRules.endpointId, notificationEndpoints.id)
    )
    .where(
      and(
        eq(notificationRules.projectId, projectId),
        eq(notificationRules.onSpike, true),
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
    assigneeUserId: issue.assigneeUserId,
  };

  for (const rule of rules) {
    if (rule.kind === "email" && !orgEmailEnabled) continue;
    if (rule.kind === "webhook" && !env.WEBHOOK_KEK_V1) continue;
    if (rule.filterQuery && rule.filterQuery.trim()) {
      const q = parseSearchQuery(rule.filterQuery);
      if (!matchIssue(issueLike, q)) continue;
    }
    const now = Date.now();
    const cutoff = now - rule.minIntervalSeconds * 1000;
    const upd = await env.DB_CONTROL.prepare(
      "UPDATE notification_rules SET last_fired_at = ?1 WHERE id = ?2 AND (last_fired_at IS NULL OR last_fired_at < ?3)"
    )
      .bind(now, rule.ruleId, cutoff)
      .run();
    if (!upd.meta.changes) continue;

    await fireSpike(env, db, {
      projectId,
      projectName,
      rule,
      issue,
      tags,
      spike,
    });
  }
}

async function fireSpike(
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
      kind: string;
      configJson: string | null;
    };
    issue: IssueSnapshot;
    tags: Record<string, string>;
    spike: { recent5min: number; baseline25min: number };
  }
): Promise<void> {
  const deliveryId = `ndv_${crypto.randomUUID().replace(/-/g, "")}`;
  const dashboardBase = env.DASHBOARD_PUBLIC_URL?.replace(/\/$/, "") ?? "";
  const dashboardUrl = dashboardBase
    ? `${dashboardBase}/p/${encodeURIComponent(args.projectId)}/issues/${encodeURIComponent(args.issue.id)}`
    : null;
  const heading = `📈 Spike: ${args.projectName}`;
  const bodyLine = `${args.issue.type}: ${args.issue.value}`;
  const rateLine = `直近5分: ${args.spike.recent5min} events (baseline 25分: ${args.spike.baseline25min})`;

  let status: "delivered" | "failed" | "rejected" = "failed";
  let responseStatus: number | null = null;
  let responseMs: number | null = null;
  let errorMessage: string | null = null;
  let payloadPreview = "";

  const started = Date.now();
  try {
    if (args.rule.kind === "email") {
      const subject = `[Wana Spike] ${args.projectName}: ${args.issue.type}`.slice(0, 250);
      const text =
        `${heading}\n\n${bodyLine}\n${rateLine}\n` +
        (args.issue.culprit ? `Culprit: ${args.issue.culprit}\n` : "") +
        (dashboardUrl ? `\n${dashboardUrl}\n` : "") +
        `\n— Wana\n`;
      payloadPreview = subject;
      const r = await sendNotificationEmail(env, {
        to: args.rule.target,
        subject,
        text,
      });
      if (r.ok) status = "delivered";
      else {
        status = r.error === "email_not_configured" ? "rejected" : "failed";
        errorMessage = r.error ?? null;
      }
    } else if (args.rule.kind === "slack") {
      const payload = {
        text: `${heading} — ${bodyLine}\n${rateLine}`,
      };
      const slackBody = JSON.stringify(payload);
      payloadPreview = slackBody.slice(0, PAYLOAD_PREVIEW_MAX);
      const r = await postChatWebhook(args.rule.target, slackBody, "Slack");
      status = r.status;
      responseStatus = r.responseStatus;
      errorMessage = r.errorMessage;
    } else if (args.rule.kind === "discord") {
      const payload = {
        content: heading,
        embeds: [
          {
            description: `\`${args.issue.type}\`\n${truncateMrkdwn(args.issue.value, 600)}\n\n**${rateLine}**`,
            color: 0xf97316,
            url: dashboardUrl ?? undefined,
          },
        ],
      };
      const body = JSON.stringify(payload);
      payloadPreview = body.slice(0, PAYLOAD_PREVIEW_MAX);
      const targetUrl = withDiscordThreadId(args.rule.target, args.rule.configJson);
      const r = await postChatWebhook(targetUrl, body, "Discord");
      status = r.status;
      responseStatus = r.responseStatus;
      errorMessage = r.errorMessage;
    } else {
      const signedAt = Math.floor(Date.now() / 1000);
      const body = JSON.stringify({
        version: 1,
        delivery_id: deliveryId,
        event_kind: "issue.spike",
        signed_at: signedAt,
        project_id: args.projectId,
        project_name: args.projectName,
        issue: {
          id: args.issue.id,
          type: args.issue.type,
          value: args.issue.value,
          culprit: args.issue.culprit,
          fingerprint: args.issue.fingerprint,
          status: args.issue.status,
          first_seen: Math.floor(args.issue.firstSeen / 1000),
          last_seen: Math.floor(args.issue.lastSeen / 1000),
          tags: args.tags,
        },
        spike: {
          recent_5min: args.spike.recent5min,
          baseline_25min: args.spike.baseline25min,
        },
        dashboard_url: dashboardUrl,
      });
      payloadPreview = body.slice(0, PAYLOAD_PREVIEW_MAX);
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
      errorMessage = result.errorMessage ?? null;
      status =
        result.status >= 200 && result.status < 300 ? "delivered" : "failed";
    }
  } catch (err) {
    status = "rejected";
    errorMessage = err instanceof Error ? err.message : "unknown error";
  }
  responseMs = Date.now() - started;

  const createdAt = new Date();
  await db.insert(notificationDeliveries).values({
    id: deliveryId,
    ruleId: args.rule.ruleId,
    endpointId: args.rule.endpointId,
    projectId: args.projectId,
    issueId: args.issue.id,
    eventKind: "issue.spike",
    status,
    attempt: 1,
    responseStatus,
    responseMs,
    errorMessage,
    payloadPreview,
    createdAt,
    deliveredAt: status === "delivered" ? createdAt : null,
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
  // KEK is required only for the webhook channel; checked per-branch below.
  const db = drizzle(env.DB_CONTROL);
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
    const subject = `[Wana] テスト通知: ${projectName}`;
    const text = `Wana からのテスト通知です。\nProject: ${projectName}\nTriggered by: ${args.triggeredByUserId}\nAt (unix): ${signedAt}\n\n受信できていれば設定は正常です。\n`;
    payloadPreview = subject;
    try {
      const r = await sendNotificationEmail(env, {
        to: ep[0].target,
        subject,
        text,
      });
      if (r.ok) status = "delivered";
      else {
        status = r.error === "email_not_configured" ? "rejected" : "failed";
        errorMessage = r.error ?? null;
      }
    } catch (e) {
      status = "rejected";
      errorMessage = e instanceof Error ? e.message : "unknown error";
    }
    responseMs = Date.now() - started;
  } else if (ep[0].kind === "discord") {
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
    const discordBody = JSON.stringify(payload);
    payloadPreview = discordBody.slice(0, PAYLOAD_PREVIEW_MAX);
    try {
      const targetUrl = withDiscordThreadId(ep[0].target, ep[0].configJson);
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": USER_AGENT,
        },
        body: discordBody,
        redirect: "manual",
      });
      responseStatus = res.status;
      status =
        res.status >= 200 && res.status < 300 ? "delivered" : "failed";
      if (status !== "delivered") {
        const text = await res.text().catch(() => "");
        errorMessage = text
          ? `Discord: ${text.slice(0, 200)}`
          : `HTTP ${res.status}`;
      }
    } catch (e) {
      status = "rejected";
      errorMessage = e instanceof Error ? e.message : "unknown error";
    }
    responseMs = Date.now() - started;
  } else if (ep[0].kind === "slack") {
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
    const slackBody = JSON.stringify(payload);
    payloadPreview = slackBody.slice(0, PAYLOAD_PREVIEW_MAX);
    try {
      const res = await fetch(ep[0].target, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": USER_AGENT,
        },
        body: slackBody,
        redirect: "manual",
      });
      responseStatus = res.status;
      status =
        res.status >= 200 && res.status < 300 ? "delivered" : "failed";
      if (status !== "delivered") {
        const text = await res.text().catch(() => "");
        errorMessage = text
          ? `Slack: ${text.slice(0, 200)}`
          : `HTTP ${res.status}`;
      }
    } catch (e) {
      status = "rejected";
      errorMessage = e instanceof Error ? e.message : "unknown error";
    }
    responseMs = Date.now() - started;
  } else {
    if (!env.WEBHOOK_KEK_V1) throw new Error("Webhook KEK が未設定です");
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

/**
 * Run a sql-bound `UPDATE` with returning() against drizzle, used for the
 * compare-and-set throttle. (sql import is here so the linter doesn't strip it.)
 */
const _keepSqlImport = sql;
void _keepSqlImport;
