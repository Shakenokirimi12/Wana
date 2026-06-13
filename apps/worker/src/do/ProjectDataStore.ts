import { DurableObject } from "cloudflare:workers";
import { drizzle, DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { eq, desc, sql, lt, inArray } from "drizzle-orm";
import { issues, events } from "@wana/schema/data-plane";
import migrations from "@wana/schema/data-plane-migrations";
import type { ParsedEnvelope, IssueStatus } from "@wana/types";
import type { Env } from "../types";
import { parseEventFromEnvelope, type ExtractedEventMetadata } from "../lib/event-parser";

interface EventInput {
  envelope: ParsedEnvelope;
  r2Key: string;
  receivedAt: number;
}

export class ProjectDataStore extends DurableObject<Env> {
  private readonly workerEnv: Env;
  private db: DrizzleSqliteDODatabase;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.workerEnv = env;
    this.db = drizzle(ctx.storage, { logger: false });

    ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, migrations);
    });
  }

  /** HTTP + WebSocket (Hibernation API): dashboard proxies Upgrade here via DO stub.fetch. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket Upgrade", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    this.ctx.waitUntil(this.sendSnapshotToWebSocket(server));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer
  ): Promise<void> {
    const text =
      typeof message === "string"
        ? message
        : new TextDecoder().decode(message);
    if (text === "ping") {
      try {
        ws.send(JSON.stringify({ type: "pong", t: Date.now() }));
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      const j = JSON.parse(text) as { type?: string };
      if (j?.type === "refresh") {
        await this.sendSnapshotToWebSocket(ws);
      }
    } catch {
      /* ignore */
    }
  }

  async webSocketClose(
    _ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean
  ): Promise<void> {
    /* hibernation: socket removed automatically */
  }

  private async sendSnapshotToWebSocket(ws: WebSocket): Promise<void> {
    const snapshot = await this.issuesSnapshotPayload();
    try {
      ws.send(JSON.stringify(snapshot));
    } catch {
      /* closed */
    }
  }

  private async issuesSnapshotPayload() {
    const issues = await this.getIssues({ limit: 100 });
    return { type: "issues" as const, issues };
  }

  private async broadcastIssuesSnapshot(): Promise<void> {
    const payload = JSON.stringify(await this.issuesSnapshotPayload());
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        /* ignore */
      }
    }
  }

  async insertEvents(eventInputs: EventInput[]): Promise<void> {
    const parsedItems = eventInputs
      .map((e) => ({
        meta: parseEventFromEnvelope(e.envelope, e.receivedAt),
        eventId: e.envelope.header.event_id,
        r2Key: e.r2Key,
      }))
      .filter((x) => x.meta !== null) as {
      meta: ExtractedEventMetadata;
      eventId: string;
      r2Key: string;
    }[];

    if (parsedItems.length === 0) return;

    // Group items by fingerprint to handle batching within a single DO request
    const groups = new Map<string, typeof parsedItems>();
    for (const item of parsedItems) {
      const list = groups.get(item.meta.fingerprint) || [];
      list.push(item);
      groups.set(item.meta.fingerprint, list);
    }

    for (const [fingerprint, items] of groups.entries()) {
      const latestItem = items.reduce((prev, curr) =>
        curr.meta.timestamp > prev.meta.timestamp ? curr : prev
      );
      const earliestItem = items.reduce((prev, curr) =>
        curr.meta.timestamp < prev.meta.timestamp ? curr : prev
      );

      // Find-or-create the issue first (events.issueId FK).
      const existing = await this.db
        .select({ id: issues.id })
        .from(issues)
        .where(eq(issues.fingerprint, fingerprint))
        .limit(1);

      let issueId: string;
      let issueIsNew = false;
      if (existing.length > 0) {
        issueId = existing[0].id;
      } else {
        issueId = crypto.randomUUID();
        issueIsNew = true;
        await this.db.insert(issues).values({
          id: issueId,
          fingerprint,
          type: latestItem.meta.type,
          value: latestItem.meta.value,
          status: "unresolved",
          eventsCount: 0,
          firstSeen: earliestItem.meta.timestamp,
          lastSeen: latestItem.meta.timestamp,
          culprit: latestItem.meta.culprit,
        });
      }

      // Idempotent insert: duplicate event_id (SDK retries / queue redelivery)
      // is ignored. `returning` gives us the rows that were actually inserted so
      // eventsCount reflects only NEW events — no double-counting, no poison loop.
      const inserted = await this.db
        .insert(events)
        .values(
          items.map((item) => ({
            id: item.eventId,
            issueId,
            timestamp: item.meta.timestamp,
            environment: item.meta.environment,
            release: item.meta.release,
            r2PayloadKey: item.r2Key,
          }))
        )
        .onConflictDoNothing()
        .returning({ id: events.id });

      const newCount = inserted.length;
      if (newCount > 0) {
        await this.db
          .update(issues)
          .set({
            eventsCount: sql`${issues.eventsCount} + ${newCount}`,
            // Out-of-order delivery (queue redelivery / late SDK flush) must not
            // regress lastSeen — keep the newest.
            lastSeen: sql`max(${issues.lastSeen}, ${latestItem.meta.timestamp.getTime()})`,
          })
          .where(eq(issues.id, issueId));
      } else if (issueIsNew) {
        // Every event in a brand-new issue was a duplicate (re-delivery after a
        // mid-batch crash). Drop the empty issue row to avoid a count=0 orphan.
        await this.db.delete(issues).where(eq(issues.id, issueId));
      }
    }

    // Schedule alarm for data retention cleanup
    const alarm = await this.ctx.storage.getAlarm();
    if (!alarm) {
      await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
    }

    this.ctx.waitUntil(this.broadcastIssuesSnapshot());
  }

  // RPC methods for dashboard
  async getIssues(options?: {
    status?: IssueStatus;
    limit?: number;
    offset?: number;
  }) {
    const limit = Math.min(Math.max(options?.limit || 50, 1), 200);
    const offset = Math.max(options?.offset || 0, 0);
    const status = options?.status;

    if (status) {
      return this.db
        .select()
        .from(issues)
        .where(eq(issues.status, status))
        .orderBy(desc(issues.lastSeen))
        .limit(limit)
        .offset(offset);
    }

    return this.db
      .select()
      .from(issues)
      .orderBy(desc(issues.lastSeen))
      .limit(limit)
      .offset(offset);
  }

  /** Counts for issue stream tabs (Sentry-style). */
  async getIssueTabCounts(): Promise<{
    all: number;
    unresolved: number;
    resolved: number;
    ignored: number;
  }> {
    const countWhere = async (
      cond?: ReturnType<typeof eq>
    ): Promise<number> => {
      const base = this.db.select({ c: sql<number>`count(*)` }).from(issues);
      const [row] = cond ? await base.where(cond) : await base;
      return Number(row?.c ?? 0);
    };

    const [all, unresolved, resolved, ignored] = await Promise.all([
      countWhere(),
      countWhere(eq(issues.status, "unresolved")),
      countWhere(eq(issues.status, "resolved")),
      countWhere(eq(issues.status, "ignored")),
    ]);

    return { all, unresolved, resolved, ignored };
  }

  async getIssue(issueId: string) {
    const result = await this.db
      .select()
      .from(issues)
      .where(eq(issues.id, issueId))
      .limit(1);

    return result[0] || null;
  }

  async getEvents(issueId: string, options?: { limit?: number; offset?: number }) {
    const limit = Math.min(Math.max(options?.limit || 50, 1), 200);
    const offset = Math.max(options?.offset || 0, 0);

    return this.db
      .select()
      .from(events)
      .where(eq(events.issueId, issueId))
      .orderBy(desc(events.timestamp))
      .limit(limit)
      .offset(offset);
  }

  async updateIssueStatus(issueId: string, status: IssueStatus): Promise<void> {
    await this.db
      .update(issues)
      .set({ status })
      .where(eq(issues.id, issueId));
    this.ctx.waitUntil(this.broadcastIssuesSnapshot());
  }

  /**
   * Hard-delete ALL data for this project: every R2 payload, every event, every
   * issue. Used by project deletion (control plane deletes its rows separately).
   */
  async purgeAllData(): Promise<{ deletedEvents: number }> {
    const rows = await this.db
      .select({ r2: events.r2PayloadKey })
      .from(events);
    const keys = [...new Set(rows.map((r) => r.r2))];
    for (let i = 0; i < keys.length; i += 1000) {
      await this.workerEnv.PAYLOAD_STORAGE.delete(keys.slice(i, i + 1000));
    }
    await this.db.delete(events);
    await this.db.delete(issues);
    this.ctx.waitUntil(this.broadcastIssuesSnapshot());
    return { deletedEvents: rows.length };
  }

  /** Retention window in days. Override via SYSTEM_CONFIG KV `RETENTION_DAYS`. */
  private async resolveRetentionDays(): Promise<number> {
    try {
      const raw = await this.workerEnv.SYSTEM_CONFIG.get("RETENTION_DAYS");
      const n = raw ? Number.parseInt(raw, 10) : NaN;
      if (Number.isFinite(n) && n >= 1) return n;
    } catch {
      // fall through to default
    }
    return 30;
  }

  // Alarm handler for data retention (D1 spec §6.2: events + linked R2).
  // Wrapped so the alarm is ALWAYS re-armed — a failed cleanup pass must not
  // permanently halt retention and orphan R2 objects forever.
  async alarm(): Promise<void> {
    try {
      const retentionDays = await this.resolveRetentionDays();
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

      const staleRows = await this.db
        .select({ r2: events.r2PayloadKey })
        .from(events)
        .where(lt(events.timestamp, cutoff));

      const keys = [...new Set(staleRows.map((r) => r.r2))];
      // R2 delete accepts up to 1000 keys per call.
      for (let i = 0; i < keys.length; i += 1000) {
        await this.workerEnv.PAYLOAD_STORAGE.delete(keys.slice(i, i + 1000));
      }

      await this.db.delete(events).where(lt(events.timestamp, cutoff));

      const orphans = await this.db
        .select({ id: issues.id })
        .from(issues)
        .where(
          sql`NOT EXISTS (SELECT 1 FROM events WHERE events.issue_id = issues.id)`
        );

      if (orphans.length > 0) {
        await this.db
          .delete(issues)
          .where(
            inArray(
              issues.id,
              orphans.map((o) => o.id)
            )
          );
      }
    } catch (error) {
      console.error("Retention alarm cleanup failed:", error);
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
    }
  }
}
