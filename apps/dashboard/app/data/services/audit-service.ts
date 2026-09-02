import { desc, eq } from "drizzle-orm";

import { auditEvents } from "@wana/schema/control-plane";

import { createDb } from "./db-client";

export type AuditAction =
  | "org.create"
  | "org.rename"
  | "org.slug_change"
  | "member.role_change"
  | "member.remove"
  | "member.transfer_ownership"
  | "invite.create"
  | "invite.revoke"
  | "project.create"
  | "project.delete"
  | "project.quota.update"
  | "apikey.issue"
  | "apikey.revoke"
  | "apikey.restore"
  | "notification.endpoint.create"
  | "notification.endpoint.update"
  | "notification.endpoint.delete"
  | "notification.endpoint.rotate_secret"
  | "notification.rule.create"
  | "notification.rule.update"
  | "notification.rule.delete"
  | "pat.create"
  | "pat.revoke";

export interface AuditInput {
  actorUserId?: string | null;
  orgId?: string | null;
  /** Only set when the referenced project row still exists (FK). */
  projectId?: string | null;
  action: AuditAction;
  payload?: Record<string, unknown>;
}

/**
 * Append-only audit log. Best-effort: an audit write must never break the
 * action it records, so failures are swallowed (and logged).
 */
export async function recordAuditEvent(
  d1: D1Database,
  input: AuditInput
): Promise<void> {
  try {
    const db = createDb(d1);
    await db.insert(auditEvents).values({
      id: `aud_${crypto.randomUUID().replace(/-/g, "")}`,
      actorUserId: input.actorUserId ?? null,
      orgId: input.orgId ?? null,
      projectId: input.projectId ?? null,
      action: input.action,
      payloadJson: input.payload ? JSON.stringify(input.payload) : null,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error("recordAuditEvent failed:", input.action, err);
  }
}

/** Recent audit events for an org (team settings UI). */
export async function listAuditEventsForOrg(
  d1: D1Database,
  orgId: string,
  limit = 50
) {
  const db = createDb(d1);
  return db
    .select({
      id: auditEvents.id,
      actorUserId: auditEvents.actorUserId,
      projectId: auditEvents.projectId,
      action: auditEvents.action,
      payloadJson: auditEvents.payloadJson,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .where(eq(auditEvents.orgId, orgId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
}
