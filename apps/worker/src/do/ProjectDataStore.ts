import { DurableObject } from "cloudflare:workers";
import { drizzle, DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { eq, desc, sql, lt, inArray } from "drizzle-orm";
import { issues, events } from "@wana/schema/data-plane";
import migrations from "@wana/schema/data-plane-migrations";
import type { ParsedEnvelope, SentryException, IssueStatus } from "@wana/types";
import type { Env } from "../types";

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
    for (const event of eventInputs) {
      const { envelope, r2Key, receivedAt } = event;
      const eventId = envelope.header.event_id;

      // Extract exception info from the first event item
      const eventItem = envelope.items.find(
        (item) => item.header.type === "event" || item.header.type === "error"
      );
      if (!eventItem) continue;

      const payload = eventItem.payload as {
        exception?: { values: SentryException[] };
        environment?: string;
        release?: string;
        timestamp?: number;
        message?: unknown;
        level?: string;
        logger?: string;
      };

      const exception = payload.exception?.values?.[0];
      const msg =
        typeof payload.message === "string" && payload.message.length > 0
          ? payload.message
          : null;

      if (!exception && !msg) continue;

      const fingerprint = exception
        ? this.calculateFingerprint(exception)
        : this.calculateMessageFingerprint(
            msg!,
            payload.level,
            payload.logger
          );

      const issueException: SentryException = exception ?? {
        type: (payload.level?.toUpperCase() ?? "MESSAGE") as string,
        value: msg!,
        stacktrace: undefined,
      };
      const timestamp = new Date(
        payload.timestamp ? payload.timestamp * 1000 : receivedAt
      );

      let culprit: string | null = null;
      if (issueException.stacktrace?.frames?.length) {
        const topFrame =
          issueException.stacktrace.frames[
            issueException.stacktrace.frames.length - 1
          ];
        if (topFrame?.filename) {
          culprit = topFrame.lineno
            ? `${topFrame.filename}:${topFrame.lineno}`
            : topFrame.filename;
        }
      } else if (payload.logger) {
        culprit = payload.logger;
      }

      // Check if issue exists
      const existingIssue = await this.db
        .select({ id: issues.id })
        .from(issues)
        .where(eq(issues.fingerprint, fingerprint))
        .limit(1);

      let issueId: string;

      if (existingIssue.length > 0) {
        // Update existing issue
        issueId = existingIssue[0].id;
        await this.db
          .update(issues)
          .set({
            eventsCount: sql`${issues.eventsCount} + 1`,
            lastSeen: timestamp,
          })
          .where(eq(issues.id, issueId));
      } else {
        // Create new issue
        issueId = crypto.randomUUID();
        await this.db.insert(issues).values({
          id: issueId,
          fingerprint,
          type: issueException.type,
          value: issueException.value,
          status: "unresolved",
          eventsCount: 1,
          firstSeen: timestamp,
          lastSeen: timestamp,
          culprit,
        });
      }

      // Insert event
      await this.db.insert(events).values({
        id: eventId,
        issueId,
        timestamp,
        environment: payload.environment || null,
        release: payload.release || null,
        r2PayloadKey: r2Key,
      });
    }

    // Schedule alarm for data retention cleanup
    const alarm = await this.ctx.storage.getAlarm();
    if (!alarm) {
      await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
    }

    this.ctx.waitUntil(this.broadcastIssuesSnapshot());
  }

  private calculateFingerprint(exception: SentryException): string {
    const parts = [exception.type, exception.value];
    if (exception.stacktrace?.frames?.length) {
      const topFrame =
        exception.stacktrace.frames[exception.stacktrace.frames.length - 1];
      if (topFrame) {
        parts.push(
          topFrame.filename || "",
          topFrame.function || "",
          String(topFrame.lineno || "")
        );
      }
    }
    return parts.join("::");
  }

  /** Group non-exception message events (captureMessage / logger). */
  private calculateMessageFingerprint(
    message: string,
    level?: string,
    logger?: string
  ): string {
    return ["message", level ?? "info", message, logger ?? ""].join("::");
  }

  // RPC methods for dashboard
  async getIssues(options?: {
    status?: IssueStatus;
    limit?: number;
    offset?: number;
  }) {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;
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
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

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

  // Alarm handler for data retention (D1 spec §6.2: events + linked R2)
  async alarm(): Promise<void> {
    const retentionDays = 30;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const staleRows = await this.db
      .select({ r2: events.r2PayloadKey })
      .from(events)
      .where(lt(events.timestamp, cutoff));

    const seenKeys = new Set<string>();
    for (const row of staleRows) {
      if (seenKeys.has(row.r2)) continue;
      seenKeys.add(row.r2);
      await this.workerEnv.PAYLOAD_STORAGE.delete(row.r2);
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

    await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
  }
}
