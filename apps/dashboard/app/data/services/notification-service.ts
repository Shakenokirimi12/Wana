import { and, desc, eq } from "drizzle-orm";

import {
  notificationDeliveries,
  notificationEndpoints,
  notificationRules,
  organizations,
  projects,
} from "@wana/schema/control-plane";

import {
  generateWebhookSecret,
  sealWebhookSecret,
  validateWebhookUrl,
} from "@wana/core";

import { createDb } from "./db-client";
import { recordAuditEvent } from "./audit-service";
import { getProjectRoleForUser } from "./project-service";
import { orgRoleAtLeast } from "./org-service";

async function requireProjectAdmin(
  d1: D1Database,
  actingUserId: string,
  projectId: string
): Promise<{ orgId: string }> {
  const role = await getProjectRoleForUser(d1, actingUserId, projectId);
  if (!role || !orgRoleAtLeast(role, "admin")) {
    throw new Error("通知の操作には admin 以上の権限が必要です");
  }
  const db = createDb(d1);
  const rows = await db
    .select({ orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (rows.length === 0) throw new Error("プロジェクトが見つかりません");
  return { orgId: rows[0].orgId };
}

/** Read project-level feature flags by traversing project → org. */
export async function getProjectFeatures(
  d1: D1Database,
  projectId: string
): Promise<{ emailNotifications: boolean }> {
  const db = createDb(d1);
  const rows = await db
    .select({
      emailNotifications: organizations.featuresEmailNotifications,
    })
    .from(projects)
    .innerJoin(organizations, eq(projects.orgId, organizations.id))
    .where(eq(projects.id, projectId))
    .limit(1);
  return {
    emailNotifications: rows[0]?.emailNotifications ?? false,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Endpoint CRUD ───────────────────────────────────────────────────────────

export async function listEndpoints(d1: D1Database, projectId: string) {
  const db = createDb(d1);
  return db
    .select({
      id: notificationEndpoints.id,
      name: notificationEndpoints.name,
      kind: notificationEndpoints.kind,
      target: notificationEndpoints.target,
      secretHint: notificationEndpoints.secretHint,
      isActive: notificationEndpoints.isActive,
      consecutiveFailures: notificationEndpoints.consecutiveFailures,
      createdAt: notificationEndpoints.createdAt,
    })
    .from(notificationEndpoints)
    .where(eq(notificationEndpoints.projectId, projectId))
    .orderBy(desc(notificationEndpoints.createdAt));
}

export async function createEndpoint(
  d1: D1Database,
  env: { WEBHOOK_KEK_V1?: string },
  input: {
    projectId: string;
    actingUserId: string;
    name: string;
    kind?: "webhook" | "email";
    target: string;
  }
): Promise<{ id: string; plainSecret: string | null }> {
  const { orgId } = await requireProjectAdmin(d1, input.actingUserId, input.projectId);
  const name = input.name.trim();
  if (!name) throw new Error("名前を入力してください");
  const kind = input.kind ?? "webhook";

  let plainSecret: string | null = null;
  let sealed = { secretEnc: "", secretNonce: "", secretHint: "", kekVersion: 1 };
  const target = input.target.trim();

  if (kind === "webhook") {
    if (!env.WEBHOOK_KEK_V1) {
      throw new Error("Webhook KEK が未設定です（管理者に連絡してください）");
    }
    validateWebhookUrl(target);
    plainSecret = generateWebhookSecret();
    sealed = await sealWebhookSecret(env.WEBHOOK_KEK_V1, plainSecret, 1);
  } else if (kind === "email") {
    const features = await getProjectFeatures(d1, input.projectId);
    if (!features.emailNotifications) {
      throw new Error(
        "メール通知は組織プランで有効化されていません（運用者に連絡してください）"
      );
    }
    if (!EMAIL_RE.test(target)) {
      throw new Error("メールアドレスの形式が不正です");
    }
  } else {
    throw new Error("不明な配信先タイプです");
  }

  const id = `nep_${crypto.randomUUID().replace(/-/g, "")}`;
  const now = Date.now();
  const db = createDb(d1);
  await db.insert(notificationEndpoints).values({
    id,
    projectId: input.projectId,
    name,
    kind,
    target,
    secretEnc: sealed.secretEnc,
    secretNonce: sealed.secretNonce,
    secretHint: sealed.secretHint,
    kekVersion: sealed.kekVersion,
    configJson: null,
    isActive: true,
    consecutiveFailures: 0,
    createdAt: new Date(now),
    createdByUserId: input.actingUserId,
  });
  await recordAuditEvent(d1, {
    actorUserId: input.actingUserId,
    orgId,
    projectId: input.projectId,
    action: "notification.endpoint.create",
    payload: { endpointId: id, name, kind, target },
  });
  return { id, plainSecret };
}

export async function updateEndpoint(
  d1: D1Database,
  input: {
    projectId: string;
    actingUserId: string;
    endpointId: string;
    name?: string;
    target?: string;
    isActive?: boolean;
  }
): Promise<void> {
  const { orgId } = await requireProjectAdmin(d1, input.actingUserId, input.projectId);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const n = input.name.trim();
    if (!n) throw new Error("名前を入力してください");
    patch.name = n;
  }
  if (input.target !== undefined) {
    const target = input.target.trim();
    // Look up the current kind to validate the new target correctly.
    const db0 = createDb(d1);
    const cur = await db0
      .select({ kind: notificationEndpoints.kind })
      .from(notificationEndpoints)
      .where(
        and(
          eq(notificationEndpoints.id, input.endpointId),
          eq(notificationEndpoints.projectId, input.projectId)
        )
      )
      .limit(1);
    if (cur.length === 0) throw new Error("送信先が見つかりません");
    if (cur[0].kind === "email") {
      if (!EMAIL_RE.test(target)) {
        throw new Error("メールアドレスの形式が不正です");
      }
    } else {
      validateWebhookUrl(target);
    }
    patch.target = target;
  }
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  if (Object.keys(patch).length === 0) return;
  const db = createDb(d1);
  await db
    .update(notificationEndpoints)
    .set(patch)
    .where(
      and(
        eq(notificationEndpoints.id, input.endpointId),
        eq(notificationEndpoints.projectId, input.projectId)
      )
    );
  await recordAuditEvent(d1, {
    actorUserId: input.actingUserId,
    orgId,
    projectId: input.projectId,
    action: "notification.endpoint.update",
    payload: { endpointId: input.endpointId, ...patch },
  });
}

export async function rotateEndpointSecret(
  d1: D1Database,
  env: { WEBHOOK_KEK_V1?: string },
  input: { projectId: string; actingUserId: string; endpointId: string }
): Promise<{ plainSecret: string }> {
  const { orgId } = await requireProjectAdmin(d1, input.actingUserId, input.projectId);
  if (!env.WEBHOOK_KEK_V1) throw new Error("Webhook KEK が未設定です");
  const plainSecret = generateWebhookSecret();
  const sealed = await sealWebhookSecret(env.WEBHOOK_KEK_V1, plainSecret, 1);
  const db = createDb(d1);
  await db
    .update(notificationEndpoints)
    .set({
      secretEnc: sealed.secretEnc,
      secretNonce: sealed.secretNonce,
      secretHint: sealed.secretHint,
      kekVersion: sealed.kekVersion,
    })
    .where(
      and(
        eq(notificationEndpoints.id, input.endpointId),
        eq(notificationEndpoints.projectId, input.projectId)
      )
    );
  await recordAuditEvent(d1, {
    actorUserId: input.actingUserId,
    orgId,
    projectId: input.projectId,
    action: "notification.endpoint.rotate_secret",
    payload: { endpointId: input.endpointId, hint: sealed.secretHint },
  });
  return { plainSecret };
}

export async function deleteEndpoint(
  d1: D1Database,
  input: { projectId: string; actingUserId: string; endpointId: string }
): Promise<void> {
  const { orgId } = await requireProjectAdmin(d1, input.actingUserId, input.projectId);
  const db = createDb(d1);
  await db
    .delete(notificationEndpoints)
    .where(
      and(
        eq(notificationEndpoints.id, input.endpointId),
        eq(notificationEndpoints.projectId, input.projectId)
      )
    );
  await recordAuditEvent(d1, {
    actorUserId: input.actingUserId,
    orgId,
    projectId: input.projectId,
    action: "notification.endpoint.delete",
    payload: { endpointId: input.endpointId },
  });
}

// ── Rule CRUD ───────────────────────────────────────────────────────────────

export async function listRules(d1: D1Database, projectId: string) {
  const db = createDb(d1);
  return db
    .select({
      id: notificationRules.id,
      name: notificationRules.name,
      endpointId: notificationRules.endpointId,
      endpointName: notificationEndpoints.name,
      onIssueCreated: notificationRules.onIssueCreated,
      filterQuery: notificationRules.filterQuery,
      minIntervalSeconds: notificationRules.minIntervalSeconds,
      lastFiredAt: notificationRules.lastFiredAt,
      isActive: notificationRules.isActive,
    })
    .from(notificationRules)
    .leftJoin(
      notificationEndpoints,
      eq(notificationRules.endpointId, notificationEndpoints.id)
    )
    .where(eq(notificationRules.projectId, projectId))
    .orderBy(desc(notificationRules.createdAt));
}

export async function createRule(
  d1: D1Database,
  input: {
    projectId: string;
    actingUserId: string;
    name: string;
    endpointId: string;
    onIssueCreated: boolean;
    filterQuery?: string;
    minIntervalSeconds?: number;
  }
): Promise<string> {
  const { orgId } = await requireProjectAdmin(d1, input.actingUserId, input.projectId);
  const name = input.name.trim();
  if (!name) throw new Error("名前を入力してください");
  if (!input.onIssueCreated) {
    throw new Error("トリガを少なくとも1つ選んでください");
  }
  const db = createDb(d1);
  const ep = await db
    .select({ id: notificationEndpoints.id })
    .from(notificationEndpoints)
    .where(
      and(
        eq(notificationEndpoints.id, input.endpointId),
        eq(notificationEndpoints.projectId, input.projectId)
      )
    )
    .limit(1);
  if (ep.length === 0) throw new Error("送信先が見つかりません");
  const id = `nrl_${crypto.randomUUID().replace(/-/g, "")}`;
  const now = Date.now();
  const minInterval = Math.max(0, Math.min(input.minIntervalSeconds ?? 60, 3600));
  await db.insert(notificationRules).values({
    id,
    projectId: input.projectId,
    endpointId: input.endpointId,
    name,
    onIssueCreated: input.onIssueCreated,
    onIssueResolved: false,
    onIssueRegressed: false,
    onSpike: false,
    filterQuery: input.filterQuery?.trim() || null,
    minIntervalSeconds: minInterval,
    isActive: true,
    createdAt: new Date(now),
    createdByUserId: input.actingUserId,
  });
  await recordAuditEvent(d1, {
    actorUserId: input.actingUserId,
    orgId,
    projectId: input.projectId,
    action: "notification.rule.create",
    payload: { ruleId: id, name, endpointId: input.endpointId },
  });
  return id;
}

export async function updateRule(
  d1: D1Database,
  input: {
    projectId: string;
    actingUserId: string;
    ruleId: string;
    isActive?: boolean;
  }
): Promise<void> {
  const { orgId } = await requireProjectAdmin(d1, input.actingUserId, input.projectId);
  const patch: Record<string, unknown> = {};
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  if (Object.keys(patch).length === 0) return;
  const db = createDb(d1);
  await db
    .update(notificationRules)
    .set(patch)
    .where(
      and(
        eq(notificationRules.id, input.ruleId),
        eq(notificationRules.projectId, input.projectId)
      )
    );
  await recordAuditEvent(d1, {
    actorUserId: input.actingUserId,
    orgId,
    projectId: input.projectId,
    action: "notification.rule.update",
    payload: { ruleId: input.ruleId, ...patch },
  });
}

export async function deleteRule(
  d1: D1Database,
  input: { projectId: string; actingUserId: string; ruleId: string }
): Promise<void> {
  const { orgId } = await requireProjectAdmin(d1, input.actingUserId, input.projectId);
  const db = createDb(d1);
  await db
    .delete(notificationRules)
    .where(
      and(
        eq(notificationRules.id, input.ruleId),
        eq(notificationRules.projectId, input.projectId)
      )
    );
  await recordAuditEvent(d1, {
    actorUserId: input.actingUserId,
    orgId,
    projectId: input.projectId,
    action: "notification.rule.delete",
    payload: { ruleId: input.ruleId },
  });
}

// ── Deliveries (read-only listing) ──────────────────────────────────────────

export async function listRecentDeliveries(
  d1: D1Database,
  projectId: string,
  limit = 30
) {
  const db = createDb(d1);
  return db
    .select({
      id: notificationDeliveries.id,
      ruleId: notificationDeliveries.ruleId,
      endpointId: notificationDeliveries.endpointId,
      issueId: notificationDeliveries.issueId,
      eventKind: notificationDeliveries.eventKind,
      status: notificationDeliveries.status,
      responseStatus: notificationDeliveries.responseStatus,
      responseMs: notificationDeliveries.responseMs,
      errorMessage: notificationDeliveries.errorMessage,
      createdAt: notificationDeliveries.createdAt,
    })
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.projectId, projectId))
    .orderBy(desc(notificationDeliveries.createdAt))
    .limit(limit);
}
