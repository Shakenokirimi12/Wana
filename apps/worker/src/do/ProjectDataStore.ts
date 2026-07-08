import { DurableObject } from "cloudflare:workers";
import { drizzle, DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { eq, desc, sql, lt, gte, and, inArray } from "drizzle-orm";
import {
  debugFiles,
  events,
  eventTags,
  issueActivity,
  issueComments,
  issues,
} from "@wana/schema/data-plane";
import migrations from "@wana/schema/data-plane-migrations";
import type { ParsedEnvelope, IssueStatus } from "@wana/types";
import type { Env } from "../types";
import { parseEventFromEnvelope, type ExtractedEventMetadata } from "../lib/event-parser";
import {
  dispatchIssueCreated,
  dispatchIssueSpike,
  dispatchIssueStatusChange,
} from "../notifications/dispatch";

interface EventInput {
  envelope: ParsedEnvelope;
  r2Key: string;
  receivedAt: number;
}

/**
 * Discriminated union returned by `getIssueTimeline`. Timestamps are ms
 * unix epoch (not Date) — DurableObject RPC type marshalling can collapse
 * unions whose variants contain `Date` to `never` on the caller side.
 */
export type TimelineEntry =
  | {
      kind: "comment";
      id: string;
      authorUserId: string;
      body: string;
      createdAtMs: number;
      updatedAtMs: number | null;
    }
  | {
      kind: "activity";
      id: string;
      actorUserId: string | null;
      activityKind: string;
      payload: Record<string, unknown> | null;
      createdAtMs: number;
    };

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

  async insertEvents(eventInputs: EventInput[], projectId?: string): Promise<void> {
    // Issues that were freshly created in this batch — pushed to the webhook
    // dispatcher AFTER all DB writes settle, via ctx.waitUntil (so ingest
    // latency is unaffected and a misconfigured endpoint can't 5xx its way
    // into a queue redelivery loop).
    const newIssuesForDispatch: Array<{
      id: string;
      type: string;
      value: string;
      culprit: string | null;
      fingerprint: string;
      firstSeenMs: number;
      lastSeenMs: number;
      tags: Record<string, string>;
      assigneeUserId: string | null;
    }> = [];
    const regressedIssuesForDispatch: Array<{
      id: string;
      type: string;
      value: string;
      culprit: string | null;
      fingerprint: string;
      firstSeenMs: number;
      lastSeenMs: number;
      tags: Record<string, string>;
      assigneeUserId: string | null;
    }> = [];
    // Issues that received new events on an existing fingerprint — candidates
    // for spike detection (a brand-new issue can't be a spike).
    const touchedExistingIssues: Array<{
      id: string;
      type: string;
      value: string;
      culprit: string | null;
      fingerprint: string;
      firstSeenMs: number;
      lastSeenMs: number;
      tags: Record<string, string>;
      assigneeUserId: string | null;
    }> = [];
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
        .select({
          id: issues.id,
          status: issues.status,
          assigneeUserId: issues.assigneeUserId,
        })
        .from(issues)
        .where(eq(issues.fingerprint, fingerprint))
        .limit(1);

      let issueId: string;
      let issueIsNew = false;
      let issueRegressed = false;
      if (existing.length > 0) {
        issueId = existing[0].id;
        // Auto-regression: a previously-resolved fingerprint just fired again.
        // Flip the row back to unresolved and remember to dispatch the
        // issue.regressed notification after we finish writing events.
        if (existing[0].status === "resolved") {
          await this.db
            .update(issues)
            .set({ status: "unresolved" })
            .where(eq(issues.id, issueId));
          await this.appendActivity(issueId, null, "regression_auto", {
            from: "resolved",
            to: "unresolved",
          });
          issueRegressed = true;
        }
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
            // Canonical, no whitespace, key-sorted — lets the LIKE-based
            // fallback search work predictably even without the normalized table.
            tagsJson: JSON.stringify(
              Object.fromEntries(
                Object.entries(item.meta.tags).sort(([a], [b]) => a.localeCompare(b))
              )
            ),
          }))
        )
        .onConflictDoNothing()
        .returning({ id: events.id });

      // Mirror tags into the normalized table for indexed search. Only insert
      // rows for events that were actually new (skip rows that lost the
      // onConflictDoNothing race so we don't duplicate-PK error here).
      const insertedIds = new Set(inserted.map((r) => r.id));
      const tagRows = items
        .filter((item) => insertedIds.has(item.eventId))
        .flatMap((item) =>
          Object.entries(item.meta.tags).map(([key, value]) => ({
            eventId: item.eventId,
            key,
            value,
          }))
        );
      if (tagRows.length > 0) {
        // SQLite multi-row insert hard cap (≤500 rows per statement) — we
        // currently process small batches, so a single insert is fine.
        await this.db.insert(eventTags).values(tagRows).onConflictDoNothing();
      }

      const newCount = inserted.length;

      // Audit BUG-4+5: previously, timestamp refresh + regression dispatch
      // were both gated on `newCount > 0`. That made a redelivered batch of
      // pure duplicates silently flip a resolved issue to unresolved
      // without notifying, and meant a late dupe with an earlier timestamp
      // couldn't pull firstSeen back. Decouple from `newCount`.
      const snap = {
        id: issueId,
        type: latestItem.meta.type,
        value: latestItem.meta.value,
        culprit: latestItem.meta.culprit,
        fingerprint,
        firstSeenMs: earliestItem.meta.timestamp.getTime(),
        lastSeenMs: latestItem.meta.timestamp.getTime(),
        tags: latestItem.meta.tags,
        assigneeUserId: issueIsNew ? null : existing[0].assigneeUserId,
      };

      if (issueIsNew && newCount === 0) {
        // Every event in a brand-new issue was a duplicate (re-delivery
        // after a mid-batch crash). Drop the empty issue row to avoid a
        // count=0 orphan.
        await this.db.delete(issues).where(eq(issues.id, issueId));
        continue;
      }

      // Always refresh firstSeen/lastSeen against this batch's known
      // timestamps. The events in the batch carry the SDK's timestamps even
      // when their event_id collides with an existing row. eventsCount
      // bumps only for genuinely new event rows.
      await this.db
        .update(issues)
        .set({
          ...(newCount > 0
            ? { eventsCount: sql`${issues.eventsCount} + ${newCount}` }
            : {}),
          lastSeen: sql`max(${issues.lastSeen}, ${latestItem.meta.timestamp.getTime()})`,
          firstSeen: sql`min(${issues.firstSeen}, ${earliestItem.meta.timestamp.getTime()})`,
        })
        .where(eq(issues.id, issueId));

      if (issueIsNew) {
        // newCount > 0 here (we returned above when 0 + new).
        newIssuesForDispatch.push(snap);
      } else if (issueRegressed) {
        // Status flip was already committed; notify even when every event
        // in this batch was a duplicate.
        regressedIssuesForDispatch.push(snap);
      }
      // Spike detection: only when we actually wrote new event rows — no
      // rate change from a pure dupe replay.
      if (!issueIsNew && newCount > 0) {
        touchedExistingIssues.push(snap);
      }
    }

    // Schedule alarm for data retention cleanup
    const alarm = await this.ctx.storage.getAlarm();
    if (!alarm) {
      await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
    }

    this.ctx.waitUntil(this.broadcastIssuesSnapshot());

    // Notifications dispatch — runs after the response. We skip if the caller
    // didn't pass a projectId (legacy callers), and the dispatcher itself
    // bails when WEBHOOK_KEK_V1 is unset, so this never blocks ingest.
    if (projectId && newIssuesForDispatch.length > 0) {
      for (const issueSnap of newIssuesForDispatch) {
        this.ctx.waitUntil(
          dispatchIssueCreated(
            this.workerEnv,
            projectId,
            {
              id: issueSnap.id,
              type: issueSnap.type,
              value: issueSnap.value,
              culprit: issueSnap.culprit,
              fingerprint: issueSnap.fingerprint,
              status: "unresolved",
              firstSeen: issueSnap.firstSeenMs,
              lastSeen: issueSnap.lastSeenMs,
              assigneeUserId: issueSnap.assigneeUserId,
            },
            issueSnap.tags
          ).catch((e) => {
            console.error("dispatchIssueCreated failed:", e);
          })
        );
      }
    }
    if (projectId && regressedIssuesForDispatch.length > 0) {
      for (const issueSnap of regressedIssuesForDispatch) {
        this.ctx.waitUntil(
          dispatchIssueStatusChange(
            this.workerEnv,
            projectId,
            {
              id: issueSnap.id,
              type: issueSnap.type,
              value: issueSnap.value,
              culprit: issueSnap.culprit,
              fingerprint: issueSnap.fingerprint,
              status: "unresolved",
              firstSeen: issueSnap.firstSeenMs,
              lastSeen: issueSnap.lastSeenMs,
              assigneeUserId: issueSnap.assigneeUserId,
            },
            issueSnap.tags,
            "regressed"
          ).catch((e) => {
            console.error("dispatchIssueStatusChange failed:", e);
          })
        );
      }
    }
    // Spike detection for touched (non-new) issues. Computes the ratio in a
    // separate pass so we don't slow down the hot ingest write path.
    if (projectId && touchedExistingIssues.length > 0) {
      this.ctx.waitUntil(this.maybeDispatchSpikes(projectId, touchedExistingIssues));
    }
  }

  /**
   * Decide whether each touched issue qualifies as a "spike" — sustained
   * activity in the last 5 minutes that's well above the prior-25-min
   * baseline. We require an absolute floor too (≥10 events in 5 min) so
   * low-volume issues with sparse history don't false-positive.
   */
  private async maybeDispatchSpikes(
    projectId: string,
    issues: Array<{
      id: string;
      type: string;
      value: string;
      culprit: string | null;
      fingerprint: string;
      firstSeenMs: number;
      lastSeenMs: number;
      tags: Record<string, string>;
      assigneeUserId: string | null;
    }>
  ): Promise<void> {
    const now = Date.now();
    const SPIKE_MIN = 10;
    const SPIKE_RATIO = 3; // recent rate ≥ 3× baseline (scaled to same window length)
    // De-dup: an issue might appear in this batch multiple times.
    const seen = new Set<string>();
    for (const snap of issues) {
      if (seen.has(snap.id)) continue;
      seen.add(snap.id);
      try {
        const { recent5min, baseline25min } = await this.getRecentEventCounts(
          snap.id,
          now
        );
        if (recent5min < SPIKE_MIN) continue;
        // Scale baseline to a 5-min equivalent (baseline25min / 5).
        const baselinePer5min = baseline25min / 5;
        if (recent5min < baselinePer5min * SPIKE_RATIO) continue;
        await dispatchIssueSpike(
          this.workerEnv,
          projectId,
          {
            id: snap.id,
            type: snap.type,
            value: snap.value,
            culprit: snap.culprit,
            fingerprint: snap.fingerprint,
            status: "unresolved",
            firstSeen: snap.firstSeenMs,
            lastSeen: snap.lastSeenMs,
            assigneeUserId: snap.assigneeUserId,
          },
          snap.tags,
          { recent5min, baseline25min }
        );
      } catch (e) {
        console.error("spike dispatch failed:", e);
      }
    }
  }

  // RPC methods for dashboard
  async getIssues(options?: {
    status?: IssueStatus;
    limit?: number;
    offset?: number;
    /** Raw search bar input — parsed in-DO so the dashboard doesn't have to. */
    search?: string;
  }) {
    const limit = Math.min(Math.max(options?.limit || 50, 1), 200);
    const offset = Math.max(options?.offset || 0, 0);
    const status = options?.status;

    const search = (options?.search ?? "").trim();
    if (!search) {
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

    // Parse the search and build a parameterized SQL query against the DO's
    // raw `storage.sql` API (Drizzle's dynamic builder is awkward for this
    // shape, and the raw API supports prepared statements directly). All
    // user-supplied values are passed as bind params — no SQL injection.
    // See packages/core/src/search-query.ts for the grammar.
    const { parseSearchQuery } = await import("@wana/core");
    const q = parseSearchQuery(search);

    const effectiveStatus = q.status && q.status !== "all" ? q.status : status;

    const whereParts: string[] = [];
    const binds: (string | number)[] = [];

    if (effectiveStatus) {
      whereParts.push("i.status = ?");
      binds.push(effectiveStatus);
    }

    for (const t of q.freeText) {
      whereParts.push(
        "(lower(i.value) LIKE ? OR lower(i.type) LIKE ? OR lower(coalesce(i.culprit,'')) LIKE ?)"
      );
      const pat = `%${t.toLowerCase()}%`;
      binds.push(pat, pat, pat);
    }

    // Positive tag filters: SAME event must satisfy them all (bind to `e`).
    for (const tf of q.tagFilters) {
      const placeholders = tf.values.map(() => "?").join(",");
      whereParts.push(
        `EXISTS (SELECT 1 FROM event_tags t WHERE t.event_id=e.id AND t.key=? AND lower(t.value) IN (${placeholders}))`
      );
      binds.push(tf.key.toLowerCase());
      for (const v of tf.values) binds.push(v.toLowerCase());
    }

    for (const k of q.hasKeys) {
      whereParts.push(
        "EXISTS (SELECT 1 FROM event_tags t WHERE t.event_id=e.id AND t.key=?)"
      );
      binds.push(k.toLowerCase());
    }

    for (const nf of q.negTagFilters) {
      whereParts.push(
        "NOT EXISTS (SELECT 1 FROM events e2 JOIN event_tags t ON t.event_id=e2.id WHERE e2.issue_id=i.id AND t.key=? AND lower(t.value)=?)"
      );
      binds.push(nf.key.toLowerCase(), nf.value.toLowerCase());
    }
    for (const nk of q.negHasKeys) {
      whereParts.push(
        "NOT EXISTS (SELECT 1 FROM events e2 JOIN event_tags t ON t.event_id=e2.id WHERE e2.issue_id=i.id AND t.key=?)"
      );
      binds.push(nk.toLowerCase());
    }

    // Assignee filters (F-ASSIGN). `is:assigned` / `is:unassigned` first,
    // then explicit positive / negative user IDs.
    if (q.assignedState === true) {
      whereParts.push("i.assignee_user_id IS NOT NULL");
    } else if (q.assignedState === false) {
      whereParts.push("i.assignee_user_id IS NULL");
    }
    if (q.assignees.length > 0) {
      const placeholders = q.assignees.map(() => "?").join(",");
      whereParts.push(`i.assignee_user_id IN (${placeholders})`);
      for (const u of q.assignees) binds.push(u);
    }
    for (const u of q.negAssignees) {
      whereParts.push(
        "(i.assignee_user_id IS NULL OR i.assignee_user_id != ?)"
      );
      binds.push(u);
    }

    const where =
      whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

    const stmt = `SELECT DISTINCT i.id, i.fingerprint, i.type, i.value, i.status, i.events_count,
              i.culprit, i.first_seen, i.last_seen, i.assignee_user_id
         FROM issues i
         INNER JOIN events e ON e.issue_id = i.id
         ${where}
         ORDER BY i.last_seen DESC
         LIMIT ${limit} OFFSET ${offset}`;

    const cursor = this.ctx.storage.sql.exec(stmt, ...binds);
    const rows = cursor.toArray() as Array<{
      id: string;
      fingerprint: string;
      type: string;
      value: string;
      status: IssueStatus;
      events_count: number;
      culprit: string | null;
      first_seen: number;
      last_seen: number;
      assignee_user_id: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      fingerprint: r.fingerprint,
      type: r.type,
      value: r.value,
      status: r.status,
      eventsCount: Number(r.events_count ?? 0),
      culprit: r.culprit ?? null,
      firstSeen: new Date(Number(r.first_seen)),
      lastSeen: new Date(Number(r.last_seen)),
      assigneeUserId: r.assignee_user_id ?? null,
    }));
  }

  /**
   * Counts for issue stream tabs (Sentry-style). Single grouped scan
   * instead of 4 separate COUNT(*) queries — same result for ~1/4 the work.
   */
  async getIssueTabCounts(): Promise<{
    all: number;
    unresolved: number;
    resolved: number;
    ignored: number;
  }> {
    const rows = await this.db
      .select({
        status: issues.status,
        c: sql<number>`count(*)`,
      })
      .from(issues)
      .groupBy(issues.status);
    let unresolved = 0;
    let resolved = 0;
    let ignored = 0;
    for (const r of rows) {
      const c = Number(r.c ?? 0);
      if (r.status === "unresolved") unresolved = c;
      else if (r.status === "resolved") resolved = c;
      else if (r.status === "ignored") ignored = c;
    }
    return {
      all: unresolved + resolved + ignored,
      unresolved,
      resolved,
      ignored,
    };
  }

  /**
   * One-shot snapshot for the issue-stream page: tab counts + 24h
   * histogram + filtered issue rows in a single DO RPC. Saves 2 cross-
   * isolate round trips per page render.
   */
  async getStreamSnapshot(opts: {
    status?: IssueStatus;
    search?: string;
    limit?: number;
    histogramHours?: number;
  }): Promise<{
    tabCounts: {
      all: number;
      unresolved: number;
      resolved: number;
      ignored: number;
    };
    histogram: { bucketStartMs: number; count: number }[];
    issues: Awaited<ReturnType<ProjectDataStore["getIssues"]>>;
  }> {
    // Run all three reads concurrently inside the DO so the dashboard
    // only pays one RPC round trip. Note `getIssues` parses the search
    // query so we feed the raw string through.
    const [tabCounts, histogram, issuesList] = await Promise.all([
      this.getIssueTabCounts(),
      this.getEventHistogram({ hours: opts.histogramHours ?? 24 }),
      this.getIssues({
        status: opts.status,
        search: opts.search,
        limit: opts.limit ?? 100,
      }),
    ]);
    return { tabCounts, histogram, issues: issuesList };
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

  /**
   * Tags from the most recent event of an issue, for issue-detail rendering.
   * Returns {} for issues whose latest event predates the tags feature.
   */
  async getLatestEventTags(issueId: string): Promise<Record<string, string>> {
    const rows = await this.db
      .select({ tagsJson: events.tagsJson })
      .from(events)
      .where(eq(events.issueId, issueId))
      .orderBy(desc(events.timestamp))
      .limit(1);
    const raw = rows[0]?.tagsJson;
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string") out[k] = v;
        }
        return out;
      }
    } catch {
      /* fall through */
    }
    return {};
  }

  /**
   * Set or clear the assignee for an issue. The DO doesn't validate
   * userId against control-plane membership — the caller (dashboard
   * route handler) must enforce that the assignee is actually a member
   * of the project's org. We just store the opaque string.
   */
  async updateIssueAssignee(
    issueId: string,
    assigneeUserId: string | null,
    actorUserId?: string | null
  ): Promise<void> {
    // Read previous to log the transition.
    const prior = await this.db
      .select({ id: issues.id, assigneeUserId: issues.assigneeUserId })
      .from(issues)
      .where(eq(issues.id, issueId))
      .limit(1);
    if (prior.length === 0) return;
    const prev = prior[0].assigneeUserId ?? null;
    if (prev === assigneeUserId) return;
    await this.db
      .update(issues)
      .set({ assigneeUserId })
      .where(eq(issues.id, issueId));
    await this.appendActivity(issueId, actorUserId ?? null, "assign", {
      from: prev,
      to: assigneeUserId,
    });
    this.ctx.waitUntil(this.broadcastIssuesSnapshot());
  }

  /** Append an entry to the activity timeline (status changes, assigns, …). */
  private async appendActivity(
    issueId: string,
    actorUserId: string | null,
    kind: string,
    payload: Record<string, unknown> | null
  ): Promise<void> {
    await this.db.insert(issueActivity).values({
      id: `act_${crypto.randomUUID().replace(/-/g, "")}`,
      issueId,
      actorUserId,
      kind,
      payloadJson: payload ? JSON.stringify(payload) : null,
      createdAt: new Date(),
    });
  }

  /**
   * List recent comments + activity for an issue, merged and ordered desc.
   * Timestamps are returned as unix-ms numbers — the DurableObject RPC
   * marshaller narrows discriminated unions to `never` on the caller side
   * when struct fields contain `Date`, so we keep the wire shape
   * primitive-only.
   */
  async getIssueTimeline(
    issueId: string,
    limit = 100
  ): Promise<TimelineEntry[]> {
    const [commentRows, activityRows] = await Promise.all([
      this.db
        .select()
        .from(issueComments)
        .where(eq(issueComments.issueId, issueId))
        .orderBy(desc(issueComments.createdAt))
        .limit(limit),
      this.db
        .select()
        .from(issueActivity)
        .where(eq(issueActivity.issueId, issueId))
        .orderBy(desc(issueActivity.createdAt))
        .limit(limit),
    ]);
    const merged: TimelineEntry[] = [
      ...commentRows.map(
        (r): TimelineEntry => ({
          kind: "comment",
          id: r.id,
          authorUserId: r.authorUserId,
          body: r.body,
          createdAtMs: r.createdAt.getTime(),
          updatedAtMs: r.updatedAt ? r.updatedAt.getTime() : null,
        })
      ),
      ...activityRows.map(
        (r): TimelineEntry => ({
          kind: "activity",
          id: r.id,
          actorUserId: r.actorUserId,
          activityKind: r.kind,
          payload: r.payloadJson
            ? (JSON.parse(r.payloadJson) as Record<string, unknown>)
            : null,
          createdAtMs: r.createdAt.getTime(),
        })
      ),
    ];
    merged.sort((a, b) => b.createdAtMs - a.createdAtMs);
    return merged.slice(0, limit);
  }

  /** Add a new comment. Returns the inserted id. */
  async addIssueComment(
    issueId: string,
    authorUserId: string,
    body: string
  ): Promise<string> {
    const trimmed = body.trim();
    if (!trimmed) throw new Error("コメント本文を入力してください");
    if (trimmed.length > 8000) throw new Error("コメントが長すぎます (8000 文字以内)");
    const id = `cmt_${crypto.randomUUID().replace(/-/g, "")}`;
    const now = new Date();
    await this.db.insert(issueComments).values({
      id,
      issueId,
      authorUserId,
      body: trimmed,
      createdAt: now,
      updatedAt: null,
    });
    await this.appendActivity(issueId, authorUserId, "comment", {
      commentId: id,
    });
    return id;
  }

  /** Delete a comment. Caller MUST verify ownership before invoking. */
  async deleteIssueComment(commentId: string): Promise<void> {
    await this.db.delete(issueComments).where(eq(issueComments.id, commentId));
  }

  /** Look up a single comment (used for ownership checks). */
  async getIssueComment(
    commentId: string
  ): Promise<{ id: string; issueId: string; authorUserId: string } | null> {
    const rows = await this.db
      .select({
        id: issueComments.id,
        issueId: issueComments.issueId,
        authorUserId: issueComments.authorUserId,
      })
      .from(issueComments)
      .where(eq(issueComments.id, commentId))
      .limit(1);
    return rows[0] ?? null;
  }

  // ── Debug files (dSYM index) ────────────────────────────────────────

  /**
   * Upsert a debug file by UUID. If a prior row exists for the same image
   * UUID, its row is deleted and the prior `r2Key` is returned so the
   * caller can purge the old R2 object — keeping at most one dSYM per
   * UUID is the storage-control mechanism (the CLI re-uploads on every
   * archive, so accumulating old builds would balloon R2 fast).
   */
  async insertDebugFile(input: {
    uuid: string;
    arch: string | null;
    originalFilename: string;
    r2Key: string;
    sizeBytes: number;
    uploadedByUserId: string | null;
    gitSha?: string | null;
    gitRepo?: string | null;
  }): Promise<{ id: string; replacedR2Key: string | null }> {
    const id = `df_${crypto.randomUUID().replace(/-/g, "")}`;
    const uuid = input.uuid.toLowerCase();
    const existing = await this.db
      .select({ id: debugFiles.id, r2Key: debugFiles.r2Key })
      .from(debugFiles)
      .where(eq(debugFiles.uuid, uuid))
      .limit(1);
    const replacedR2Key = existing[0]?.r2Key ?? null;
    if (existing[0]) {
      await this.db.delete(debugFiles).where(eq(debugFiles.id, existing[0].id));
    }
    await this.db.insert(debugFiles).values({
      id,
      uuid,
      arch: input.arch,
      originalFilename: input.originalFilename,
      r2Key: input.r2Key,
      sizeBytes: input.sizeBytes,
      uploadedAt: new Date(),
      uploadedByUserId: input.uploadedByUserId,
      gitSha: input.gitSha ?? null,
      gitRepo: input.gitRepo ?? null,
    });
    return { id, replacedR2Key };
  }

  async listDebugFiles(): Promise<
    Array<{
      id: string;
      uuid: string;
      arch: string | null;
      originalFilename: string;
      r2Key: string;
      sizeBytes: number;
      uploadedAt: Date;
      uploadedByUserId: string | null;
      gitSha: string | null;
      gitRepo: string | null;
    }>
  > {
    return this.db
      .select()
      .from(debugFiles)
      .orderBy(desc(debugFiles.uploadedAt))
      .limit(200);
  }

  /**
   * Bulk-lookup debug-file presence + optional git context for image
   * UUIDs. Used by the issue detail page to (a) decide which frames can
   * link to GitHub and (b) show an "Upload dSYM" prompt for UUIDs that
   * have no debug-file row at all. Presence in the returned map = a
   * debug file is registered for that UUID; `gitSha`/`gitRepo` may
   * still be null when the upload predates the CLI git-context patch.
   */
  async findDebugFileMetaByUuids(
    uuids: string[]
  ): Promise<
    Record<string, { gitSha: string | null; gitRepo: string | null }>
  > {
    if (uuids.length === 0) return {};
    const normalized = uuids.map((u) => u.toLowerCase());
    const rows = await this.db
      .select({
        uuid: debugFiles.uuid,
        gitSha: debugFiles.gitSha,
        gitRepo: debugFiles.gitRepo,
      })
      .from(debugFiles)
      .where(inArray(debugFiles.uuid, normalized));
    const out: Record<
      string,
      { gitSha: string | null; gitRepo: string | null }
    > = {};
    for (const r of rows) {
      out[r.uuid] = { gitSha: r.gitSha ?? null, gitRepo: r.gitRepo ?? null };
    }
    return out;
  }

  /**
   * Look up the most recently uploaded debug file matching a Mach-O UUID
   * (lowercased 32-hex). Returns null when the project never uploaded one
   * for that image, which is the common signal "skip symbolication".
   */
  async findDebugFileByUuid(uuid: string): Promise<
    | {
        id: string;
        uuid: string;
        r2Key: string;
        originalFilename: string;
        sizeBytes: number;
      }
    | null
  > {
    const rows = await this.db
      .select({
        id: debugFiles.id,
        uuid: debugFiles.uuid,
        r2Key: debugFiles.r2Key,
        originalFilename: debugFiles.originalFilename,
        sizeBytes: debugFiles.sizeBytes,
      })
      .from(debugFiles)
      .where(eq(debugFiles.uuid, uuid.toLowerCase()))
      .orderBy(desc(debugFiles.uploadedAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Remove a debug-file row and return the r2Key so the caller can also
   * delete the R2 payload (the DO doesn't have the R2 binding by itself
   * — the worker does; same pattern as deleteIssue / purgeAllData).
   */
  async deleteDebugFile(id: string): Promise<{ r2Key: string | null }> {
    const rows = await this.db
      .select({ r2Key: debugFiles.r2Key })
      .from(debugFiles)
      .where(eq(debugFiles.id, id))
      .limit(1);
    if (rows.length === 0) return { r2Key: null };
    await this.db.delete(debugFiles).where(eq(debugFiles.id, id));
    return { r2Key: rows[0].r2Key };
  }

  /**
   * Hard-delete a single issue and all of its events + tag rows + R2
   * payloads. Used for cleaning up junk issues (test data, mistargeted
   * envelopes). Returns the number of events removed for the UI flash.
   *
   * Audit BUG-2 fix: explicitly delete event_tags first because the DO
   * SQLite isn't running with PRAGMA foreign_keys = ON, so the schema's
   * CASCADE doesn't actually fire.
   */
  async deleteIssue(issueId: string): Promise<{ deletedEvents: number }> {
    const evRows = await this.db
      .select({ id: events.id, r2: events.r2PayloadKey })
      .from(events)
      .where(eq(events.issueId, issueId));
    if (evRows.length === 0) {
      // Issue might exist with no events (unlikely but safe). Just remove
      // the row and bail.
      await this.db.delete(issues).where(eq(issues.id, issueId));
      this.ctx.waitUntil(this.broadcastIssuesSnapshot());
      return { deletedEvents: 0 };
    }
    const eventIds = evRows.map((r) => r.id);
    const r2Keys = [...new Set(evRows.map((r) => r.r2))];
    for (let i = 0; i < r2Keys.length; i += 1000) {
      await this.workerEnv.PAYLOAD_STORAGE.delete(r2Keys.slice(i, i + 1000));
    }
    // SQLite's inArray() handles batching; we keep it under the 999-param
    // limit by chunking ids ourselves.
    for (let i = 0; i < eventIds.length; i += 500) {
      const chunk = eventIds.slice(i, i + 500);
      await this.db.delete(eventTags).where(inArray(eventTags.eventId, chunk));
      await this.db.delete(events).where(inArray(events.id, chunk));
    }
    await this.db.delete(issues).where(eq(issues.id, issueId));
    this.ctx.waitUntil(this.broadcastIssuesSnapshot());
    return { deletedEvents: evRows.length };
  }

  /**
   * Hourly event counts over the last N hours. Returns N entries newest-last
   * (so the rightmost bar in a chart is the current hour). Used by the
   * project overview chart and the per-issue sparkline.
   *
   * `issueId` narrows to a single issue; omit for project-wide totals.
   */
  async getEventHistogram(args: {
    hours: number;
    issueId?: string;
    nowMs?: number;
  }): Promise<{ bucketStartMs: number; count: number }[]> {
    const hours = Math.max(1, Math.min(args.hours, 24 * 14));
    const HOUR = 3600_000;
    // Align right edge to the START of the current hour + 1, so the latest
    // bucket covers the in-progress hour. This keeps bar heights stable as
    // chart re-renders during a single hour.
    const now = args.nowMs ?? Date.now();
    const currentHourStart = Math.floor(now / HOUR) * HOUR;
    const firstBucketStart = currentHourStart - (hours - 1) * HOUR;
    const windowEnd = currentHourStart + HOUR;

    // Group events into hour buckets via integer division. Force the
    // result to INTEGER — JS-bound numbers can land as REAL in SQLite,
    // which would give every event a unique fractional bucket key and
    // make `groupBy` essentially no-op (one row per event, not per hour).
    // Use raw `>=` / `<` against the ms column instead of `gte()` with a
    // Date so the comparison is unambiguously integer-on-integer.
    const bucketExpr = sql<number>`CAST((${events.timestamp} - ${firstBucketStart}) / ${HOUR} AS INTEGER)`;
    const baseSelect = this.db
      .select({
        bucket: bucketExpr,
        c: sql<number>`count(*)`,
      })
      .from(events);
    const rows = args.issueId
      ? await baseSelect
          .where(
            and(
              eq(events.issueId, args.issueId),
              sql`${events.timestamp} >= ${firstBucketStart}`,
              sql`${events.timestamp} < ${windowEnd}`
            )
          )
          .groupBy(bucketExpr)
      : await baseSelect
          .where(
            and(
              sql`${events.timestamp} >= ${firstBucketStart}`,
              sql`${events.timestamp} < ${windowEnd}`
            )
          )
          .groupBy(bucketExpr);

    const counts = new Map<number, number>();
    for (const row of rows) {
      counts.set(Number(row.bucket), Number(row.c));
    }
    const out: { bucketStartMs: number; count: number }[] = [];
    for (let i = 0; i < hours; i++) {
      out.push({
        bucketStartMs: firstBucketStart + i * HOUR,
        count: counts.get(i) ?? 0,
      });
    }
    return out;
  }

  /**
   * Release rollup. Groups events by their `release` field (Sentry-style
   * version string) and returns per-release totals. Releases with NULL/
   * empty values are excluded — only events that an SDK actually tagged
   * with a version get counted.
   */
  async getReleaseRollup(): Promise<
    Array<{
      release: string;
      eventsCount: number;
      issuesCount: number;
      firstSeenMs: number;
      lastSeenMs: number;
    }>
  > {
    const rows = await this.db
      .select({
        release: events.release,
        eventsCount: sql<number>`count(*)`,
        issuesCount: sql<number>`count(distinct ${events.issueId})`,
        firstSeenMs: sql<number>`min(${events.timestamp})`,
        lastSeenMs: sql<number>`max(${events.timestamp})`,
      })
      .from(events)
      .where(sql`${events.release} IS NOT NULL AND ${events.release} != ''`)
      .groupBy(events.release)
      .orderBy(desc(sql`max(${events.timestamp})`))
      .limit(50);
    return rows.map((r) => ({
      release: r.release ?? "",
      eventsCount: Number(r.eventsCount),
      issuesCount: Number(r.issuesCount),
      firstSeenMs: Number(r.firstSeenMs),
      lastSeenMs: Number(r.lastSeenMs),
    }));
  }

  /**
   * Spike detector. Returns count buckets for an issue: events in the last
   * 5 minutes (the "recent rate") and the 25 minutes preceding that (the
   * "baseline"). Caller decides whether the ratio is spike-worthy.
   */
  async getRecentEventCounts(
    issueId: string,
    nowMs: number = Date.now()
  ): Promise<{ recent5min: number; baseline25min: number }> {
    // Same caveat as getEventHistogram: use raw `>=` / `<` against the
    // INTEGER ms column so the comparison is integer-on-integer.
    const window5Ms = nowMs - 5 * 60_000;
    const baselineStartMs = nowMs - 30 * 60_000;
    const [recentRow, baselineRow] = await Promise.all([
      this.db
        .select({ c: sql<number>`count(*)` })
        .from(events)
        .where(
          and(
            eq(events.issueId, issueId),
            sql`${events.timestamp} >= ${window5Ms}`
          )
        ),
      this.db
        .select({ c: sql<number>`count(*)` })
        .from(events)
        .where(
          and(
            eq(events.issueId, issueId),
            sql`${events.timestamp} >= ${baselineStartMs}`,
            sql`${events.timestamp} < ${window5Ms}`
          )
        ),
    ]);
    return {
      recent5min: Number(recentRow[0]?.c ?? 0),
      baseline25min: Number(baselineRow[0]?.c ?? 0),
    };
  }

  async updateIssueStatus(
    issueId: string,
    status: IssueStatus,
    projectId?: string,
    actorUserId?: string | null
  ): Promise<void> {
    // Read previous state so we can detect the resolved/regressed transition
    // BEFORE writing the new status.
    const prior = await this.db
      .select()
      .from(issues)
      .where(eq(issues.id, issueId))
      .limit(1);
    if (prior.length === 0) {
      // Nothing to update — DB write would be a no-op anyway.
      return;
    }
    const prev = prior[0];
    if (prev.status === status) {
      return;
    }
    await this.db
      .update(issues)
      .set({ status })
      .where(eq(issues.id, issueId));
    await this.appendActivity(issueId, actorUserId ?? null, "status_change", {
      from: prev.status,
      to: status,
    });
    this.ctx.waitUntil(this.broadcastIssuesSnapshot());

    // Status-change notification: explicit user resolve / un-resolve.
    // - any → resolved      → issue.resolved
    // - resolved → unresolved → issue.regressed (manual re-open)
    let changeKind: "resolved" | "regressed" | null = null;
    if (prev.status !== "resolved" && status === "resolved") {
      changeKind = "resolved";
    } else if (prev.status === "resolved" && status === "unresolved") {
      changeKind = "regressed";
    }
    if (changeKind && projectId) {
      const tags = await this.getLatestEventTags(issueId);
      const snap = {
        id: prev.id,
        type: prev.type,
        value: prev.value,
        culprit: prev.culprit,
        fingerprint: prev.fingerprint,
        status,
        firstSeen: prev.firstSeen.getTime(),
        lastSeen: prev.lastSeen.getTime(),
        assigneeUserId: prev.assigneeUserId,
      };
      this.ctx.waitUntil(
        dispatchIssueStatusChange(
          this.workerEnv,
          projectId,
          snap,
          tags,
          changeKind
        )
      );
    }
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
    // Audit BUG-2: DO SQLite does not enable PRAGMA foreign_keys, so the
    // schema-level ON DELETE CASCADE on event_tags doesn't actually fire.
    // Delete tags explicitly BEFORE events to avoid orphan tag rows.
    await this.db.delete(eventTags);
    await this.db.delete(events);
    await this.db.delete(issues);
    this.ctx.waitUntil(this.broadcastIssuesSnapshot());
    return { deletedEvents: rows.length };
  }

  /**
   * Retention window in days. Resolution order:
   *   1. Explicit override stored on the DO (set via `setRetentionDays`)
   *   2. SYSTEM_CONFIG KV `RETENTION_DAYS` (legacy / global default)
   *   3. 30 (fallback)
   * The override path lets the dashboard's per-project Settings UI
   * write a retention value into DO storage without round-tripping to
   * the control-plane row on every alarm.
   */
  private async resolveRetentionDays(): Promise<number> {
    try {
      const override = await this.ctx.storage.get<number>("retentionDaysOverride");
      if (typeof override === "number" && override >= 1) return override;
    } catch {
      /* fall through */
    }
    try {
      const raw = await this.workerEnv.SYSTEM_CONFIG.get("RETENTION_DAYS");
      const n = raw ? Number.parseInt(raw, 10) : NaN;
      if (Number.isFinite(n) && n >= 1) return n;
    } catch {
      // fall through to default
    }
    return 30;
  }

  /** Dashboard writes this when an admin updates retention in the UI. */
  async setRetentionDays(days: number | null): Promise<void> {
    if (days == null) {
      await this.ctx.storage.delete("retentionDaysOverride");
      return;
    }
    const clamped = Math.max(1, Math.min(365, Math.floor(days)));
    await this.ctx.storage.put("retentionDaysOverride", clamped);
  }

  /**
   * Lightweight storage stats used by the project settings "Storage" card.
   * Returns row counts the DO can compute cheaply — R2 byte-size is a
   * separate sweep done by the worker since it needs the bucket binding.
   */
  async getStorageStats(): Promise<{
    issueCount: number;
    eventCount: number;
    distinctR2Keys: number;
    oldestEventMs: number | null;
    newestEventMs: number | null;
  }> {
    const issueCountRow = await this.db
      .select({ c: sql<number>`count(*)` })
      .from(issues);
    const eventStatsRow = await this.db
      .select({
        c: sql<number>`count(*)`,
        oldest: sql<number | null>`min(${events.timestamp})`,
        newest: sql<number | null>`max(${events.timestamp})`,
        distinctR2: sql<number>`count(DISTINCT ${events.r2PayloadKey})`,
      })
      .from(events);
    return {
      issueCount: Number(issueCountRow[0]?.c ?? 0),
      eventCount: Number(eventStatsRow[0]?.c ?? 0),
      distinctR2Keys: Number(eventStatsRow[0]?.distinctR2 ?? 0),
      oldestEventMs: eventStatsRow[0]?.oldest
        ? Number(eventStatsRow[0].oldest)
        : null,
      newestEventMs: eventStatsRow[0]?.newest
        ? Number(eventStatsRow[0].newest)
        : null,
    };
  }

  // Alarm handler for data retention (D1 spec §6.2: events + linked R2).
  // Wrapped so the alarm is ALWAYS re-armed — a failed cleanup pass must not
  // permanently halt retention and orphan R2 objects forever.
  async alarm(): Promise<void> {
    try {
      const retentionDays = await this.resolveRetentionDays();
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

      const staleRows = await this.db
        .select({ id: events.id, r2: events.r2PayloadKey })
        .from(events)
        .where(lt(events.timestamp, cutoff));

      const keys = [...new Set(staleRows.map((r) => r.r2))];
      // R2 delete accepts up to 1000 keys per call.
      for (let i = 0; i < keys.length; i += 1000) {
        await this.workerEnv.PAYLOAD_STORAGE.delete(keys.slice(i, i + 1000));
      }

      // Audit BUG-2: PRAGMA foreign_keys is OFF in DO SQLite so the
      // schema-level CASCADE on event_tags doesn't fire. Delete the
      // matching tag rows explicitly before deleting the events.
      const staleIds = staleRows.map((r) => r.id);
      for (let i = 0; i < staleIds.length; i += 500) {
        const chunk = staleIds.slice(i, i + 500);
        await this.db
          .delete(eventTags)
          .where(inArray(eventTags.eventId, chunk));
      }

      // NOTE: issues.eventsCount is a LIFETIME-cumulative total (matches Sentry's
      // "times seen" semantics) — it is intentionally NOT decremented when stale
      // event rows are purged here. So an old issue can legitimately report a
      // count larger than the number of event rows currently retained. Issues
      // whose events are ALL purged become orphans and are deleted just below.
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
