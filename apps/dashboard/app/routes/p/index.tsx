import { Hono } from "hono";

import type { IssueStatus } from "@wana/types";

import {
  getProjectAccessSummary,
  getProjectRow,
  getProjectRowByExternalId,
  userCanAccessProject,
  getProjectRoleForUser,
  listApiKeysForProject,
  updateProjectQuota,
  issueApiKeyForProject,
  setApiKeyActive,
  deleteProject,
} from "@/data/control-plane";
import {
  listProjectMembersForAssignee,
  orgRoleAtLeast,
} from "@/data/services/org-service";
import {
  durableObjectIdForStoredProject,
  extractMachOUuid,
  extractSentryKeyFromRequest,
  hashHex,
} from "@wana/core";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import { apiKeys as apiKeysTable, projects as projectsTable } from "@wana/schema/control-plane";
import {
  getDashboardUserId,
  ingestPublicOrigin,
} from "@/lib/dashboard-user";
import { loadShellSidebar } from "@/lib/shell-data";
import { buildSdkSnippets } from "@/lib/sdk-snippets";
import { projectIssuesLiveScript } from "@/lib/project-issues-live";
import {
  parseIssueStreamQuery,
  issueStreamQueryParam,
  formatIssueDetailTime,
  issueStreamTabHref,
  isIssueStreamTabActive,
  formatIssueStreamRelativeTime,
  type IssueStreamFilter,
} from "@/lib/issue-stream";
import {
  Badge,
  ButtonDestructiveOutline,
  ButtonPrimary,
  ButtonSecondary,
  Card,
  InputField,
  IssueStatusToolbar,
  PageHeader,
  TextLink,
  issueStatusVariant,
} from "@/ui/components";
import { Shell } from "@/ui/shell";
import { AreaChart24h, Sparkline24h } from "@/ui/charts";
import { UserIcon } from "@/ui/icons";
import {
  EventPayloadView,
  mergeSymbolicatedPayload,
  parseStoredEventPayload,
  type SymbolsFile,
} from "@/ui/event-payload";
import CopyButton from "@/islands/copy-button";
import type { Env } from "@/types/bindings";

const projectsRoute = new Hono<{ Bindings: Env }>();

type IssueStreamRow = {
  id: string;
  fingerprint: string;
  type: string;
  value: string;
  status: IssueStatus;
  eventsCount: number;
  firstSeen: Date;
  lastSeen: Date;
  culprit: string | null;
  assigneeUserId: string | null;
};

/** Lightweight project-member lookup for the stream — userId → display name. */
type AssigneeLookup = Map<string, { name: string; email: string }>;

/**
 * Render a one-line label for an activity-timeline entry. We resolve user
 * ids against the project member list when we can — fall back to a short
 * id slice when the actor has since left the project.
 */
function timelineActivityLabel(
  kind: string,
  payload: Record<string, unknown> | null,
  members: { userId: string; name: string; email: string }[]
): string {
  const userLabel = (uid: unknown): string => {
    if (typeof uid !== "string") return "(unknown)";
    const m = members.find((mm) => mm.userId === uid);
    return m ? m.name || m.email : uid.slice(0, 8);
  };
  switch (kind) {
    case "status_change":
      return `status: ${payload?.from ?? "?"} → ${payload?.to ?? "?"}`;
    case "assign": {
      const from = payload?.from ?? null;
      const to = payload?.to ?? null;
      if (!from && to) return `担当者 → ${userLabel(to)}`;
      if (from && !to) return `担当解除（前: ${userLabel(from)}）`;
      return `担当者 ${userLabel(from)} → ${userLabel(to)}`;
    }
    case "regression_auto":
      return "auto-regression (new event)";
    case "comment":
      return "コメント";
    default:
      return kind;
  }
}

function issueStreamTabClass(active: boolean): string {
  const base =
    "inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-1 py-2 text-sm font-medium transition-colors";
  return active
    ? `${base} border-amber-500 text-kumo-default`
    : `${base} border-transparent text-kumo-subtle hover:border-kumo-line hover:text-kumo-default`;
}

function IssueStreamTabs(props: {
  projectId: string;
  active: IssueStreamFilter;
  counts: {
    all: number;
    unresolved: number;
    resolved: number;
    ignored: number;
  };
}) {
  const { projectId, active, counts } = props;
  const tabs: {
    label: string;
    filter: IssueStreamFilter;
    n: number;
  }[] = [
    {
      label: "Unresolved",
      filter: { kind: "status", status: "unresolved" },
      n: counts.unresolved,
    },
    { label: "All", filter: { kind: "all" }, n: counts.all },
    {
      label: "Resolved",
      filter: { kind: "status", status: "resolved" },
      n: counts.resolved,
    },
    {
      label: "Ignored",
      filter: { kind: "status", status: "ignored" },
      n: counts.ignored,
    },
  ];

  return (
    <nav
      className="mb-1 flex flex-wrap gap-x-4 gap-y-1 border-b border-kumo-hairline"
      aria-label="Issue stream filters"
    >
      {tabs.map((t) => (
        <a
          key={t.label}
          className={issueStreamTabClass(isIssueStreamTabActive(active, t.filter))}
          href={issueStreamTabHref(projectId, t.filter)}
        >
          {t.label}
          <span className="tabular-nums text-xs font-normal text-kumo-subtle">
            {t.n}
          </span>
        </a>
      ))}
    </nav>
  );
}

function IssueStreamQueryBar(props: {
  projectId: string;
  queryParam: string;
  search: string;
}) {
  return (
    <form
      method="get"
      action={`/p/${props.projectId}`}
      role="search"
      className="mb-4 flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="query" value={props.queryParam} />
      <input
        type="search"
        name="search"
        defaultValue={props.search}
        placeholder="issue を検索 — メッセージ・型・発生箇所、または browser:Chrome / has:release / !runtime:node"
        className="h-9 min-w-[18rem] flex-1 rounded-lg border border-kumo-hairline bg-kumo-recessed px-3 text-sm text-kumo-default placeholder:text-kumo-subtle focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
      />
      <ButtonSecondary type="submit">検索</ButtonSecondary>
      <details className="relative">
        <summary
          className="cursor-help select-none rounded-full border border-kumo-hairline bg-kumo-recessed px-2.5 py-1 text-xs text-kumo-subtle hover:text-kumo-default"
          aria-label="検索構文ヘルプ"
        >
          ?
        </summary>
        <div className="absolute right-0 z-10 mt-2 w-80 rounded-lg border border-kumo-hairline bg-kumo-canvas p-3 text-xs leading-relaxed text-kumo-default shadow-lg">
          <div className="mb-1 font-semibold">検索構文</div>
          <ul className="space-y-1 text-kumo-subtle">
            <li><code className="text-kumo-default">key:value</code> — タグ完全一致</li>
            <li><code className="text-kumo-default">key:a,b</code> — どちらか一致 (OR)</li>
            <li><code className="text-kumo-default">!key:value</code> — 否定（issue 内のどの event にも無いもの）</li>
            <li><code className="text-kumo-default">has:key</code> / <code className="text-kumo-default">!has:key</code> — タグ有無</li>
            <li><code className="text-kumo-default">is:unresolved|resolved|ignored|all</code></li>
            <li>条件なしのトークン — メッセージ・型・発生箇所の部分一致</li>
          </ul>
          <div className="mt-2 text-kumo-subtle">
            主なタグ: <code>browser</code> · <code>os</code> · <code>runtime</code> · <code>environment</code> · <code>release</code> · <code>level</code> · <code>transaction</code>
          </div>
        </div>
      </details>
      {props.search ? (
        <a
          href={`/p/${props.projectId}?query=${encodeURIComponent(props.queryParam)}`}
          className="text-xs text-kumo-subtle hover:text-kumo-default"
        >
          クリア
        </a>
      ) : null}
    </form>
  );
}

function IssueStreamTable(props: {
  projectId: string;
  rows: IssueStreamRow[];
  assigneeLookup: AssigneeLookup;
}) {
  const { projectId, rows, assigneeLookup } = props;

  return (
    <div className="wana-issue-stream divide-y divide-kumo-hairline">
      <div
        className="hidden gap-0 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-kumo-subtle sm:grid sm:grid-cols-[minmax(0,1fr)_7rem_5rem_6.5rem]"
        role="row"
      >
        <div className="pr-4">Issue</div>
        <div className="text-right">Last seen</div>
        <div className="text-right">Events</div>
        <div className="text-right">Status</div>
      </div>
      {rows.map((row) => (
        <a
          key={row.id}
          className="group grid gap-3 px-5 py-4 transition-colors hover:bg-kumo-base sm:grid-cols-[minmax(0,1fr)_7rem_5rem_6.5rem] sm:items-center sm:gap-0"
          href={`/p/${projectId}/issues/${row.id}`}
        >
          <div className="min-w-0 space-y-1 pr-4">
            <p className="text-[15px] font-semibold leading-snug text-kumo-default group-hover:text-amber-400">
              {row.value}
            </p>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-kumo-subtle">
              <span className="font-medium text-kumo-subtle">{row.type}</span>
              <span className="text-kumo-subtle" aria-hidden="true">
                |
              </span>
              <span className="truncate font-mono text-[11px] text-kumo-subtle">
                {row.culprit ?? "—"}
              </span>
              {row.assigneeUserId
                ? (() => {
                    const m = assigneeLookup.get(row.assigneeUserId);
                    const label = m
                      ? m.name || m.email
                      : row.assigneeUserId.slice(0, 8);
                    return (
                      <>
                        <span className="text-kumo-subtle" aria-hidden="true">
                          ·
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-md bg-kumo-base px-1.5 py-0.5 text-[10px] font-medium text-kumo-default ring-1 ring-amber-500/30">
                          <UserIcon size={11} aria-hidden="true" />
                          {label}
                        </span>
                      </>
                    );
                  })()
                : null}
            </p>
          </div>
          <div className="text-left text-xs tabular-nums text-kumo-subtle sm:text-right">
            <span className="sm:hidden text-kumo-subtle">Last seen: </span>
            {formatIssueStreamRelativeTime(row.lastSeen.getTime())}
          </div>
          <div className="text-left text-xs tabular-nums text-kumo-subtle sm:text-right">
            <span className="sm:hidden text-kumo-subtle">Events: </span>
            {row.eventsCount}
          </div>
          <div className="flex sm:justify-end">
            <Badge variant={issueStatusVariant(row.status)}>{row.status}</Badge>
          </div>
        </a>
      ))}
    </div>
  );
}

/** Curated key order at the top of the Tags card; remaining tags are alphabetised. */
const CURATED_TAG_KEYS = [
  "level",
  "environment",
  "release",
  "transaction",
  "browser",
  "browser.version",
  "os",
  "os.version",
  "runtime",
  "runtime.version",
  "platform",
  "device.family",
  "app.version",
];

/** Build a search URL that APPENDS `key:value` to the current `?search=` (no dup, preserve `?query=`). */
function buildTagFilterHref(
  projectId: string,
  currentQuery: string,
  currentSearch: string,
  key: string,
  value: string
): string {
  const token = /\s/.test(value) ? `${key}:"${value}"` : `${key}:${value}`;
  const existing = currentSearch.split(/\s+/).filter(Boolean);
  if (!existing.includes(token)) existing.push(token);
  const params = new URLSearchParams();
  if (currentQuery) params.set("query", currentQuery);
  params.set("search", existing.join(" "));
  return `/p/${encodeURIComponent(projectId)}?${params.toString()}`;
}

function IssueTagsCard(props: {
  projectId: string;
  tags: Record<string, string>;
}) {
  const entries = Object.entries(props.tags);
  if (entries.length === 0) return null;

  const seen = new Set<string>();
  const curated: [string, string][] = [];
  for (const k of CURATED_TAG_KEYS) {
    const v = props.tags[k];
    if (typeof v === "string") {
      curated.push([k, v]);
      seen.add(k);
    }
  }
  const rest = entries
    .filter(([k]) => !seen.has(k))
    .sort(([a], [b]) => a.localeCompare(b));

  const renderChip = ([key, value]: [string, string]) => (
    <a
      key={`${key}=${value}`}
      className="inline-flex items-center gap-1.5 rounded-full border border-kumo-hairline bg-kumo-recessed px-2.5 py-1 text-xs text-kumo-default transition-colors hover:border-kumo-line hover:bg-kumo-base"
      href={buildTagFilterHref(props.projectId, "is:unresolved", "", key, value)}
      title={`${key}:${value} で絞り込み`}
    >
      <span className="font-medium text-kumo-subtle">{key}</span>
      <span className="text-kumo-subtle">:</span>
      <span className="text-kumo-default">{value}</span>
    </a>
  );

  return (
    <Card className="mb-10 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
          Tags
        </div>
        <span className="text-[11px] text-kumo-subtle">
          {entries.length} {entries.length === 1 ? "tag" : "tags"}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {curated.map(renderChip)}
        {rest.map(renderChip)}
      </div>
    </Card>
  );
}

function IssueStreamEmpty(props: {
  kind: "none" | "filtered";
  filter: IssueStreamFilter;
}) {
  if (props.kind === "none") {
    return (
      <div className="px-6 py-14 text-center">
        <p className="text-sm text-kumo-subtle">
          まだ issue がありません。SDK
          経由でエラーを送信すると、ここに表示されます。
        </p>
        <p className="mt-2 text-xs text-kumo-subtle">
          設定ページから DSN を確認してください。
        </p>
      </div>
    );
  }

  const label =
    props.filter.kind === "all"
      ? "このプロジェクトにはまだ issue がありません。"
      : props.filter.status === "unresolved"
        ? "未解決の issue はありません。"
        : props.filter.status === "resolved"
          ? "解決済みの issue はありません。"
          : "無視中の issue はありません。";

  return (
    <div className="px-6 py-14 text-center">
      <p className="text-sm text-kumo-subtle">{label}</p>
      <p className="mt-2 text-xs text-kumo-subtle">
        上のタブを切り替えるか、issue 詳細から状態を変更してください。
      </p>
    </div>
  );
}

/** Browser loads this as a classic script (React ではインライン script が実行されないことがある). */
projectsRoute.get("/:projectId/live.js", async (c) => {
  const projectId = c.req.param("projectId");
  const streamQuery = c.req.query("q") ?? "";
  const search = c.req.query("search") ?? "";
  // Pull project members for the assignee chip label map so WS-driven
  // re-renders can keep rendering names instead of dropping the chip.
  // Skip on signed-out / forbidden — the WS endpoint enforces auth, so a
  // best-effort empty map is fine here.
  const uid = getDashboardUserId(c);
  let assigneeMembers: { userId: string; name: string; email: string }[] = [];
  if (uid && (await userCanAccessProject(c.env.DB_CONTROL, uid, projectId))) {
    assigneeMembers = await listProjectMembersForAssignee(
      c.env.DB_CONTROL,
      projectId
    );
  }
  const js = projectIssuesLiveScript(
    projectId,
    streamQuery,
    search,
    assigneeMembers
  );
  return c.body(js, 200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "private, no-store",
  });
});

/** Durable Object hibernating WebSocket — proxied from browser after access check. */
projectsRoute.get("/:projectId/ws", async (c) => {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.text("Expected WebSocket Upgrade", 426);
  }

  const projectId = c.req.param("projectId");
  const uid = getDashboardUserId(c);
  if (!uid) {
    return c.redirect("/login");
  }

  const project = await getProjectRow(c.env.DB_CONTROL, projectId);
  if (!project) {
    return c.text("Forbidden", 403);
  }
  if (!(await userCanAccessProject(c.env.DB_CONTROL, uid, projectId))) {
    return c.text("Forbidden", 403);
  }

  const id = durableObjectIdForStoredProject(c.env.PROJECT_DO, project.doId);
  const stub = c.env.PROJECT_DO.get(id);
  return stub.fetch(c.req.raw as never) as unknown as Promise<Response>;
});

function NotFoundShell(props: {
  title: string;
  message: string;
  backHref: string;
  backLabel: string;
  currentPath?: string;
  projects?: { id: string; name: string }[];
  activeTeamName?: string;
  activeTeamSlug?: string;
  teamSwitcher?: { id: string; name: string; slug: string }[];
  currentProject?: { id: string; name: string };
}) {
  return (
    <Shell
      currentPath={props.currentPath}
      title={props.title}
      auth="signed-in"
      projects={props.projects}
      activeTeamName={props.activeTeamName}
      activeTeamSlug={props.activeTeamSlug}
      teamSwitcher={props.teamSwitcher}
      currentProject={props.currentProject}
    >
      <Card className="p-8 text-center">
        <p className="text-kumo-subtle">{props.message}</p>
        <div className="mt-6">
          <TextLink href={props.backHref}>{props.backLabel}</TextLink>
        </div>
      </Card>
    </Shell>
  );
}

projectsRoute.get("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const uid = getDashboardUserId(c);
  if (!uid) {
    return c.redirect("/login");
  }

  // Two parallel D1 reads: sidebar bundle + project-with-access. The
  // project lookup uses a single JOIN that returns the row only when the
  // user is a member of its org, so the access check is implicit.
  const [sidebar, project] = await Promise.all([
    loadShellSidebar(c, uid),
    getProjectAccessSummary(c.env.DB_CONTROL, projectId, uid),
  ]);
  if (!project) {
    return c.render(
      <NotFoundShell
        currentPath={c.req.path}
        title="Not found"
        message="Project not found."
        backHref="/"
        backLabel="← All projects"
        {...sidebar}
      />,
      { title: "Not found — Wana" }
    );
  }

  const id = durableObjectIdForStoredProject(c.env.PROJECT_DO, project.doId);
  const store = c.env.PROJECT_DO.get(id);
  const queryRaw = c.req.query("query");
  const streamFilter = parseIssueStreamQuery(queryRaw);

  // Rewrite `is:assigned-to-me` to the concrete user id before passing to
  // the DO. The DO does not know who "me" is.
  let search = c.req.query("search")?.trim() ?? "";
  if (search) {
    search = search
      .replace(/(^|\s)is:assigned-to-me(?=\s|$)/g, `$1assignee:${uid}`)
      .replace(/(^|\s)assignee:@me(?=\s|$)/g, `$1assignee:${uid}`)
      .replace(/(^|\s)!is:assigned-to-me(?=\s|$)/g, `$1!assignee:${uid}`)
      .replace(/(^|\s)!assignee:@me(?=\s|$)/g, `$1!assignee:${uid}`);
  }

  // Single DO round-trip (counts + histogram + filtered rows). Members are
  // loaded in parallel — but pruned to just the assignees actually in
  // view, so a 1000-member org doesn't pull 1000 rows for a stream that
  // only references 3 of them.
  const [snapshot, allMembers] = await Promise.all([
    store.getStreamSnapshot({
      limit: 100,
      ...(streamFilter.kind === "all" ? {} : { status: streamFilter.status }),
      search: search || undefined,
      histogramHours: 24,
    }),
    listProjectMembersForAssignee(c.env.DB_CONTROL, projectId),
  ]);
  const tabCounts = snapshot.tabCounts;
  const histogram = snapshot.histogram;
  const histogramTotal = histogram.reduce((acc, b) => acc + b.count, 0);
  const issueRows = snapshot.issues as unknown as IssueStreamRow[];
  const assigneeUidsInView = new Set(
    issueRows
      .map((r) => r.assigneeUserId)
      .filter((u): u is string => typeof u === "string" && u.length > 0)
  );
  const projectMembers = assigneeUidsInView.size
    ? allMembers.filter((m) => assigneeUidsInView.has(m.userId))
    : [];
  const assigneeLookup: AssigneeLookup = new Map(
    projectMembers.map((m) => [
      m.userId,
      { name: m.name, email: m.email },
    ])
  );

  const streamQueryParam = issueStreamQueryParam(streamFilter);
  const streamRows = issueRows;

  const emptyKind =
    tabCounts.all === 0
      ? ("none" as const)
      : streamRows.length === 0
        ? ("filtered" as const)
        : null;

  return c.render(
    <Shell
      currentPath={c.req.path}
      title={project.name}
      auth="signed-in"
      {...sidebar}
      currentProject={{ id: project.id, name: project.name }}
    >
      <PageHeader
        title={project.name}
        description={
          <>
            <span className="text-kumo-subtle">{project.orgName}</span>
            <span className="mx-2 text-kumo-subtle">·</span>
            <Badge variant="zinc">{project.orgSlug}</Badge>
          </>
        }
      />

      <Card className="mb-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-kumo-hairline px-5 py-3 sm:px-6">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
              直近 24 時間のイベント
            </h2>
            <p className="mt-0.5 text-lg font-semibold text-kumo-default tabular-nums">
              {histogramTotal.toLocaleString()}{" "}
              <span className="text-xs font-normal text-kumo-subtle">events</span>
            </p>
          </div>
        </div>
        <div className="px-3 py-2 sm:px-4 sm:py-3">
          <AreaChart24h buckets={histogram} height={140} />
        </div>
      </Card>

      <section className="mb-6" aria-labelledby="issue-stream-heading">
        <h2 id="issue-stream-heading" className="sr-only">
          Issues
        </h2>
        <IssueStreamTabs
          active={streamFilter}
          counts={tabCounts}
          projectId={projectId}
        />
        <IssueStreamQueryBar
          projectId={projectId}
          queryParam={streamQueryParam}
          search={search}
        />

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
              Issue stream
            </h3>
            <div
              id="wana-live-indicator"
              className="inline-flex items-center gap-2 rounded-full border border-kumo-hairline bg-kumo-recessed px-2.5 py-1"
              role="status"
              aria-live="polite"
            >
              <span
                id="wana-live-dot"
                className="h-2 w-2 shrink-0 rounded-full bg-kumo-line ring-2 ring-kumo-hairline"
                aria-hidden="true"
              />
              <span
                id="wana-live-label"
                className="text-xs font-medium tabular-nums text-kumo-subtle"
              >
                接続中…
              </span>
            </div>
            <span id="wana-update-badge" className="hidden" />
          </div>
          <span id="wana-issues-count" className="text-xs tabular-nums text-kumo-subtle">
            {streamRows.length > 0 ? `${streamRows.length} issues` : ""}
          </span>
        </div>

        <Card className="overflow-hidden">
          <div id="wana-issues-body">
            {emptyKind ? (
              <IssueStreamEmpty filter={streamFilter} kind={emptyKind} />
            ) : (
              <IssueStreamTable
                projectId={projectId}
                rows={streamRows}
                assigneeLookup={assigneeLookup}
              />
            )}
          </div>
        </Card>
      </section>
      <script
        defer
        src={`/p/${encodeURIComponent(projectId)}/live.js?q=${encodeURIComponent(streamQueryParam)}&search=${encodeURIComponent(search)}`}
      />
    </Shell>,
    { title: `${project.name} — Wana` }
  );
});

projectsRoute.post("/:projectId/issues/:issueId/comments", async (c) => {
  const projectId = c.req.param("projectId");
  const issueId = c.req.param("issueId");
  const uid = getDashboardUserId(c);
  if (!uid) return c.redirect("/login");
  if (!(await userCanAccessProject(c.env.DB_CONTROL, uid, projectId))) {
    return c.redirect("/");
  }
  const project = await getProjectRow(c.env.DB_CONTROL, projectId);
  if (!project) return c.redirect("/");

  const body = await c.req.parseBody();
  const text = String(body.body ?? "").trim();
  if (!text) {
    return c.redirect(`/p/${projectId}/issues/${issueId}#timeline`);
  }
  const doId = durableObjectIdForStoredProject(c.env.PROJECT_DO, project.doId);
  const store = c.env.PROJECT_DO.get(doId);
  try {
    await store.addIssueComment(issueId, uid, text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "送信に失敗しました";
    return c.redirect(
      `/p/${projectId}/issues/${issueId}?err=${encodeURIComponent(msg)}#timeline`
    );
  }
  return c.redirect(`/p/${projectId}/issues/${issueId}#timeline`);
});

projectsRoute.post(
  "/:projectId/issues/:issueId/comments/:commentId/delete",
  async (c) => {
    const projectId = c.req.param("projectId");
    const issueId = c.req.param("issueId");
    const commentId = c.req.param("commentId");
    const uid = getDashboardUserId(c);
    if (!uid) return c.redirect("/login");
    if (!(await userCanAccessProject(c.env.DB_CONTROL, uid, projectId))) {
      return c.redirect("/");
    }
    const project = await getProjectRow(c.env.DB_CONTROL, projectId);
    if (!project) return c.redirect("/");

    const doId = durableObjectIdForStoredProject(
      c.env.PROJECT_DO,
      project.doId
    );
    const store = c.env.PROJECT_DO.get(doId);
    const cmt = await store.getIssueComment(commentId);
    if (!cmt || cmt.issueId !== issueId) {
      return c.redirect(`/p/${projectId}/issues/${issueId}`);
    }
    // Author can always delete own; project admin can delete anyone's.
    const role = await getProjectRoleForUser(
      c.env.DB_CONTROL,
      uid,
      projectId
    );
    const isAdmin = role ? orgRoleAtLeast(role, "admin") : false;
    if (cmt.authorUserId !== uid && !isAdmin) {
      return c.redirect(
        `/p/${projectId}/issues/${issueId}?err=${encodeURIComponent("自分のコメントしか削除できません")}#timeline`
      );
    }
    await store.deleteIssueComment(commentId);
    return c.redirect(`/p/${projectId}/issues/${issueId}#timeline`);
  }
);

/** Hard-delete a single issue (events + R2 payloads + tag rows). admin+ only. */
projectsRoute.post("/:projectId/issues/:issueId/delete", async (c) => {
  const projectId = c.req.param("projectId");
  const issueId = c.req.param("issueId");
  const uid = getDashboardUserId(c);
  if (!uid) return c.redirect("/login");
  const role = await getProjectRoleForUser(c.env.DB_CONTROL, uid, projectId);
  if (!role || !orgRoleAtLeast(role, "admin")) {
    return c.redirect(`/p/${projectId}?err=${encodeURIComponent("削除には admin 以上が必要です")}`);
  }
  const project = await getProjectRow(c.env.DB_CONTROL, projectId);
  if (!project) return c.redirect("/");
  const doId = durableObjectIdForStoredProject(c.env.PROJECT_DO, project.doId);
  const store = c.env.PROJECT_DO.get(doId);
  try {
    await store.deleteIssue(issueId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "削除に失敗しました";
    return c.redirect(
      `/p/${projectId}/issues/${issueId}?err=${encodeURIComponent(msg)}`
    );
  }
  return c.redirect(`/p/${projectId}?ok=${encodeURIComponent("Issue を削除しました")}`);
});

/**
 * Set or clear an issue assignee. The selected user must be a member of
 * the project's org — we re-check here even though the dropdown only
 * lists members, in case the form was crafted by hand.
 */
projectsRoute.post("/:projectId/issues/:issueId/assign", async (c) => {
  const projectId = c.req.param("projectId");
  const issueId = c.req.param("issueId");
  const uid = getDashboardUserId(c);
  if (!uid) return c.redirect("/login");
  if (!(await userCanAccessProject(c.env.DB_CONTROL, uid, projectId))) {
    return c.redirect("/");
  }
  const project = await getProjectRow(c.env.DB_CONTROL, projectId);
  if (!project) return c.redirect("/");

  const body = await c.req.parseBody();
  const raw = String(body.assignee ?? "").trim();
  const newAssignee = raw === "" || raw === "__clear__" ? null : raw;

  if (newAssignee) {
    const members = await listProjectMembersForAssignee(
      c.env.DB_CONTROL,
      projectId
    );
    if (!members.some((m) => m.userId === newAssignee)) {
      return c.redirect(
        `/p/${projectId}/issues/${issueId}?err=${encodeURIComponent("選択したユーザーはこのプロジェクトのメンバーではありません")}`
      );
    }
  }

  const doId = durableObjectIdForStoredProject(c.env.PROJECT_DO, project.doId);
  const store = c.env.PROJECT_DO.get(doId);
  await store.updateIssueAssignee(issueId, newAssignee, uid);
  return c.redirect(`/p/${projectId}/issues/${issueId}`);
});

projectsRoute.post("/:projectId/issues/:issueId/status", async (c) => {
  const projectId = c.req.param("projectId");
  const issueId = c.req.param("issueId");
  const uid = getDashboardUserId(c);
  if (!uid) {
    return c.redirect("/login");
  }

  if (!(await userCanAccessProject(c.env.DB_CONTROL, uid, projectId))) {
    return c.redirect("/");
  }

  const project = await getProjectRow(c.env.DB_CONTROL, projectId);
  if (!project) {
    return c.redirect("/");
  }

  const body = await c.req.parseBody();
  const raw = String(body.status ?? "");
  const allowed: IssueStatus[] = ["unresolved", "resolved", "ignored"];
  if (!allowed.includes(raw as IssueStatus)) {
    return c.redirect(`/p/${projectId}/issues/${issueId}`);
  }
  const status = raw as IssueStatus;
  const id = durableObjectIdForStoredProject(c.env.PROJECT_DO, project.doId);
  const store = c.env.PROJECT_DO.get(id);
  await store.updateIssueStatus(issueId, status, projectId, uid);
  return c.redirect(`/p/${projectId}/issues/${issueId}`);
});

/**
 * Re-run dSYM symbolicate for a single event. Used after the operator
 * uploads a missing dSYM AFTER the event already arrived. Always returns
 * to the issue detail page; the symbols badge there will refresh on the
 * next render.
 */
projectsRoute.post(
  "/:projectId/issues/:issueId/events/:eventId/symbolicate",
  async (c) => {
    const projectId = c.req.param("projectId");
    const issueId = c.req.param("issueId");
    const eventId = c.req.param("eventId");
    const uid = getDashboardUserId(c);
    if (!uid) return c.redirect("/login");
    if (!(await userCanAccessProject(c.env.DB_CONTROL, uid, projectId))) {
      return c.redirect("/");
    }
    const project = await getProjectRow(c.env.DB_CONTROL, projectId);
    if (!project) return c.redirect("/");
    const back = `/p/${projectId}/issues/${issueId}`;
    if (!c.env.MAIL_SERVICE || !c.env.INTERNAL_RPC_SECRET) {
      return c.redirect(
        `${back}?err=${encodeURIComponent("symbolicator_unreachable")}`
      );
    }
    try {
      const res = await c.env.MAIL_SERVICE.fetch(
        new Request("https://wana-worker.internal/__internal/symbolicate", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-wana-internal-secret": c.env.INTERNAL_RPC_SECRET,
          },
          body: JSON.stringify({ projectId, doId: project.doId, eventId }),
        })
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return c.redirect(
          `${back}?err=${encodeURIComponent(
            "symbolicate_failed: " + text.slice(0, 120)
          )}`
        );
      }
    } catch (e) {
      return c.redirect(
        `${back}?err=${encodeURIComponent(
          "symbolicate_threw: " + (e instanceof Error ? e.message : String(e))
        )}`
      );
    }
    return c.redirect(back);
  }
);

/**
 * Releases — rolled up by SDK `release:` tag. Read-only view; useful for
 * spotting "regression introduced in v1.2.3" patterns.
 */
projectsRoute.get("/:projectId/releases", async (c) => {
  const projectId = c.req.param("projectId");
  const uid = getDashboardUserId(c);
  if (!uid) return c.redirect("/login");

  const sidebar = await loadShellSidebar(c, uid);
  const project = await getProjectRow(c.env.DB_CONTROL, projectId);
  if (!project) {
    return c.render(
      <NotFoundShell
        currentPath={c.req.path}
        title="Not found"
        message="Project not found."
        backHref="/"
        backLabel="← All projects"
        {...sidebar}
      />,
      { title: "Not found — Wana" }
    );
  }
  if (!(await userCanAccessProject(c.env.DB_CONTROL, uid, projectId))) {
    return c.redirect("/");
  }
  const id = durableObjectIdForStoredProject(c.env.PROJECT_DO, project.doId);
  const store = c.env.PROJECT_DO.get(id);
  const rows = await store.getReleaseRollup();

  return c.render(
    <Shell
      currentPath={c.req.path}
      title={`${project.name} — Releases`}
      auth="signed-in"
      {...sidebar}
      currentProject={{ id: project.id, name: project.name }}
    >
      <PageHeader
        title="Releases"
        description={`${project.name} のイベントを SDK の release タグでロールアップ。直近 50 件。`}
      />

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-kumo-subtle">
              release タグ付きのイベントがまだありません。
            </p>
            <p className="mt-2 text-xs text-kumo-subtle">
              Sentry SDK の <code className="font-mono">release</code>{" "}
              オプションを設定すると、ここでバージョン別にイベントを集計できます。
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-kumo-hairline">
            {rows.map((r) => {
              const filterQuery = `release:${r.release}`;
              return (
                <li
                  key={r.release}
                  className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center sm:px-6"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="font-mono text-sm font-medium text-kumo-default">
                        {r.release}
                      </code>
                      <Badge variant="zinc">
                        {r.eventsCount.toLocaleString()} events
                      </Badge>
                      <Badge variant="zinc">{r.issuesCount} issues</Badge>
                    </div>
                    <p className="text-[11px] text-kumo-subtle tabular-nums">
                      first {formatIssueDetailTime(r.firstSeenMs)} · last{" "}
                      {formatIssueDetailTime(r.lastSeenMs)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 justify-end">
                    <a
                      className="rounded-lg border border-kumo-hairline bg-kumo-recessed px-3 py-1.5 text-xs font-medium text-kumo-default hover:border-kumo-line hover:bg-kumo-base"
                      href={`/p/${encodeURIComponent(projectId)}?search=${encodeURIComponent(filterQuery)}`}
                    >
                      Issues を絞り込む →
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </Shell>,
    { title: `${project.name} — Releases` }
  );
});

/**
 * SDK setup wizard. Tabs across the 6 supported SDKs with install + init
 * snippets; the DSN is pre-filled when ?key=<plainKey> is passed (the
 * post-create / re-issue redirect threads it in). Without ?key=, we render
 * the snippets with a placeholder + a CTA to issue a new key.
 */
projectsRoute.get("/:projectId/setup", async (c) => {
  const projectId = c.req.param("projectId");
  const uid = getDashboardUserId(c);
  if (!uid) return c.redirect("/login");

  const sidebar = await loadShellSidebar(c, uid);
  const project = await getProjectRow(c.env.DB_CONTROL, projectId);
  if (!project) {
    return c.render(
      <NotFoundShell
        currentPath={c.req.path}
        title="Not found"
        message="Project not found."
        backHref="/"
        backLabel="← All projects"
        {...sidebar}
      />,
      { title: "Not found — Wana" }
    );
  }
  if (!(await userCanAccessProject(c.env.DB_CONTROL, uid, projectId))) {
    return c.redirect("/");
  }

  const ingestUrl = new URL(ingestPublicOrigin(c.env));
  const rawKey = c.req.query("key")?.trim();
  const publicKey = rawKey && /^[A-Za-z0-9_-]{20,200}$/.test(rawKey)
    ? rawKey
    : null;
  const placeholder = "<your-public-key>";
  const keyForDsn = publicKey ?? placeholder;
  const dsn = `${ingestUrl.protocol}//${keyForDsn}@${ingestUrl.host}/${project.externalId}`;
  const snippets = buildSdkSnippets(dsn);

  const sdkParam = c.req.query("sdk") ?? "";
  type SdkKeyParam = keyof typeof snippets;
  const validKeys: SdkKeyParam[] = [
    "cloudflare",
    "browser",
    "node",
    "react",
    "python",
    "curl",
  ];
  const activeKey: SdkKeyParam = validKeys.includes(sdkParam as SdkKeyParam)
    ? (sdkParam as SdkKeyParam)
    : "cloudflare";
  const active = snippets[activeKey];

  const baseHref = `/p/${projectId}/setup${publicKey ? `?key=${encodeURIComponent(publicKey)}` : ""}`;
  const tabHref = (k: SdkKeyParam): string => {
    const sep = baseHref.includes("?") ? "&" : "?";
    return `${baseHref}${sep}sdk=${k}`;
  };

  return c.render(
    <Shell
      currentPath={c.req.path}
      title={`${project.name} — Setup`}
      auth="signed-in"
      {...sidebar}
      currentProject={{ id: project.id, name: project.name }}
    >
      <PageHeader
        title="SDK セットアップ"
        description={`${project.name}（${project.orgName}）に SDK からエラーを送信するための DSN と各種言語のサンプルコードです。`}
      />

      <Card className="mb-8 overflow-hidden">
        <div className="border-b border-kumo-hairline px-5 py-3 sm:px-6">
          <div className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
            DSN
          </div>
        </div>
        <pre className="overflow-x-auto p-5 font-mono text-sm leading-relaxed text-kumo-default sm:p-6">
          {dsn}
        </pre>
        {publicKey ? null : (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-kumo-hairline bg-kumo-recessed px-5 py-3 text-xs text-kumo-subtle sm:px-6">
            <p>
              フル DSN を表示するには新しい API キーを発行してください
              （公開鍵は発行時のみ表示されます）。
            </p>
            <form
              method="post"
              action={`/p/${projectId}/keys`}
            >
              <ButtonSecondary type="submit">新しいキーを発行</ButtonSecondary>
            </form>
          </div>
        )}
      </Card>

      <nav
        className="mb-4 flex flex-wrap gap-2"
        aria-label="SDK selector"
      >
        {validKeys.map((k) => {
          const s = snippets[k];
          const isActive = k === activeKey;
          return (
            <a
              key={k}
              href={tabHref(k)}
              aria-current={isActive ? "page" : undefined}
              className={
                isActive
                  ? "inline-flex items-center gap-2 rounded-md bg-kumo-base px-3 py-1.5 text-xs font-semibold text-kumo-default ring-1 ring-amber-500/40"
                  : "inline-flex items-center gap-2 rounded-md border border-kumo-hairline bg-kumo-recessed px-3 py-1.5 text-xs font-medium text-kumo-subtle hover:bg-kumo-base hover:text-kumo-default"
              }
            >
              {s.label}
            </a>
          );
        })}
      </nav>

      <Card className="mb-6 p-5">
        <p className="mb-4 text-sm text-kumo-subtle">{active.tagline}</p>

        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
          インストール
        </h3>
        <pre className="mb-6 overflow-x-auto rounded-lg border border-kumo-hairline bg-kumo-recessed p-4 font-mono text-xs leading-relaxed text-kumo-default">
          {active.install.code}
        </pre>

        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
          初期化
        </h3>
        <pre className="mb-6 overflow-x-auto rounded-lg border border-kumo-hairline bg-kumo-recessed p-4 font-mono text-xs leading-relaxed text-kumo-default">
          {active.init.code}
        </pre>

        {active.test ? (
          <>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
              テスト送信
            </h3>
            <pre className="mb-4 overflow-x-auto rounded-lg border border-kumo-hairline bg-kumo-recessed p-4 font-mono text-xs leading-relaxed text-kumo-default">
              {active.test.code}
            </pre>
          </>
        ) : null}

        <p className="text-xs text-kumo-subtle">
          公式ドキュメント:{" "}
          <a
            className="text-kumo-default underline hover:text-amber-500"
            href={active.docsUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            {active.docsUrl}
          </a>
        </p>
      </Card>
    </Shell>,
    { title: `${project.name} — Setup — Wana` }
  );
});

/** Project settings: API key management + danger zone (delete). admin+ only. */
projectsRoute.get("/:projectId/settings", async (c) => {
  const projectId = c.req.param("projectId");
  const uid = getDashboardUserId(c);
  if (!uid) return c.redirect("/login");

  const sidebar = await loadShellSidebar(c, uid);
  const project = await getProjectRow(c.env.DB_CONTROL, projectId);
  if (!project) {
    return c.render(
      <NotFoundShell
        currentPath={c.req.path}
        title="Not found"
        message="Project not found."
        backHref="/"
        backLabel="← All projects"
        {...sidebar}
      />,
      { title: "Not found — Wana" }
    );
  }
  const role = await getProjectRoleForUser(c.env.DB_CONTROL, uid, projectId);
  if (!role) return c.redirect("/");
  const isAdmin = orgRoleAtLeast(role, "admin");

  const issuedKey = c.req.query("key") ?? null;
  const err = c.req.query("err") ?? null;
  const settingsOk = c.req.query("ok") ?? null;

  // Storage stats from the DO — small reads, runs in parallel with the
  // page render (no awaiting on the critical path).
  const doId = durableObjectIdForStoredProject(c.env.PROJECT_DO, project.doId);
  const storeForSettings = c.env.PROJECT_DO.get(doId);
  const [keys, storageStats, dsymFiles] = await Promise.all([
    listApiKeysForProject(c.env.DB_CONTROL, projectId, uid),
    storeForSettings.getStorageStats(),
    storeForSettings.listDebugFiles(),
  ]);

  return c.render(
    <Shell
      currentPath={c.req.path}
      title={`${project.name} — Settings`}
      auth="signed-in"
      {...sidebar}
      currentProject={{ id: project.id, name: project.name }}
    >
      <div className="mb-8">
        <TextLink href={`/p/${projectId}`}>← {project.name}</TextLink>
      </div>
      <PageHeader
        title="Project settings"
        description={`${project.name}（${project.orgName}）の API キーと削除。`}
      />

      {err ? (
        <Card className="mb-6 p-4">
          <p className="text-sm text-rose-400">{err}</p>
        </Card>
      ) : null}

      {issuedKey ? (
        <Card className="mb-6 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
              新しい API キー（この画面でのみ表示）
            </div>
            <CopyButton value={issuedKey} label="API キーをコピー" />
          </div>
          <code className="mt-2 block break-all rounded-md bg-kumo-recessed p-3 font-mono text-sm text-kumo-default">
            {issuedKey}
          </code>
          <div className="mt-4">
            <a
              href={`/p/${projectId}/setup?key=${encodeURIComponent(issuedKey)}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 shadow-sm transition hover:bg-amber-400"
            >
              SDK セットアップを表示 →
            </a>
          </div>
        </Card>
      ) : null}

      {settingsOk ? (
        <Card className="mb-6 p-4">
          <p className="text-sm text-emerald-500">{settingsOk}</p>
        </Card>
      ) : null}

      <Card className="mb-6 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
            Retention + Storage
          </h2>
          <div className="text-[11px] text-kumo-subtle">
            DO row counts は概算。R2 サイズは R2 list 1 ページ分の集計。
          </div>
        </div>
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-kumo-subtle">
              Issues
            </dt>
            <dd className="text-2xl font-semibold tabular-nums text-kumo-default">
              {storageStats.issueCount.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-kumo-subtle">
              Events (DO 行)
            </dt>
            <dd className="text-2xl font-semibold tabular-nums text-kumo-default">
              {storageStats.eventCount.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-kumo-subtle">
              R2 オブジェクト
            </dt>
            <dd className="text-2xl font-semibold tabular-nums text-kumo-default">
              {storageStats.distinctR2Keys.toLocaleString()}
            </dd>
          </div>
        </dl>
        {storageStats.oldestEventMs && storageStats.newestEventMs ? (
          <p className="mt-3 text-[11px] text-kumo-subtle">
            データ範囲:{" "}
            {formatIssueDetailTime(storageStats.oldestEventMs)} →{" "}
            {formatIssueDetailTime(storageStats.newestEventMs)}
          </p>
        ) : null}

        {isAdmin ? (
          <form
            method="post"
            action={`/p/${projectId}/quota`}
            className="mt-6 grid gap-3 sm:grid-cols-2"
          >
            <InputField
              label="保持期間（日）— 1〜365"
              name="retention_days"
              type="number"
              required
              defaultValue={String(project.retentionDays ?? 30)}
              placeholder="30"
            />
            <InputField
              label="月間イベント上限（未入力 = 無制限）"
              name="max_events_per_month"
              type="number"
              defaultValue={
                project.maxEventsPerMonth != null
                  ? String(project.maxEventsPerMonth)
                  : ""
              }
              placeholder="例: 100000"
            />
            <div className="sm:col-span-2">
              <ButtonPrimary type="submit">保存</ButtonPrimary>
            </div>
          </form>
        ) : null}
      </Card>

      <Card className="mb-8 overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-kumo-hairline px-5 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
            API keys
          </h2>
          {isAdmin ? (
            <form method="post" action={`/p/${projectId}/keys`}>
              <ButtonPrimary type="submit">＋ キーを発行</ButtonPrimary>
            </form>
          ) : null}
        </div>
        {keys.length === 0 ? (
          <p className="px-5 py-6 text-sm text-kumo-subtle">No API keys.</p>
        ) : (
          <ul className="divide-y divide-kumo-hairline">
            {keys.map((k) => (
              <li
                key={k.id}
                className="flex items-center justify-between gap-3 px-5 py-3"
              >
                <div className="flex items-center gap-3">
                  <code className="font-mono text-sm text-kumo-default">
                    {k.hint}
                  </code>
                  <Badge variant={k.isActive ? "emerald" : "zinc"}>
                    {k.isActive ? "active" : "revoked"}
                  </Badge>
                </div>
                {isAdmin ? (
                  <form
                    method="post"
                    action={`/p/${projectId}/keys/${k.id}/toggle`}
                  >
                    <input
                      type="hidden"
                      name="active"
                      value={k.isActive ? "false" : "true"}
                    />
                    <ButtonDestructiveOutline type="submit">
                      {k.isActive ? "失効" : "再有効化"}
                    </ButtonDestructiveOutline>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {isAdmin ? (
        <div id="debug-files" className="scroll-mt-6">
        <Card className="mb-6 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
            Debug files (dSYM)
          </h2>
          <p className="mt-1 text-xs text-kumo-subtle">
            ネイティブクラッシュのスタックトレースを関数名・行番号に解決するための dSYM をアップロード。
            dSYM bundle 内の{" "}
            <code className="font-mono">
              YourApp.app.dSYM/Contents/Resources/DWARF/YourApp
            </code>{" "}
            (raw Mach-O binary) を直接アップロードしてください。最大 90 MB。
          </p>
          <form
            method="post"
            action={`/p/${projectId}/debug-files`}
            encType="multipart/form-data"
            className="mt-3 flex flex-wrap items-center gap-3"
          >
            <input
              type="file"
              name="file"
              required
              className="block max-w-md text-xs text-kumo-default file:mr-3 file:rounded file:border-0 file:bg-amber-500 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-zinc-950 hover:file:bg-amber-400"
            />
            <ButtonPrimary type="submit">Upload</ButtonPrimary>
          </form>
          <ul className="mt-4 divide-y divide-kumo-hairline">
            {dsymFiles.length === 0 ? (
              <li className="py-3 text-xs text-kumo-subtle">
                まだアップロードされた dSYM はありません。
              </li>
            ) : (
              dsymFiles.map((f) => (
                <li
                  key={f.id}
                  className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="break-all font-mono text-xs text-kumo-default">
                        {f.uuid}
                      </code>
                      {f.arch ? (
                        <Badge variant="zinc">{f.arch}</Badge>
                      ) : null}
                    </div>
                    <p className="text-[11px] text-kumo-subtle">
                      {f.originalFilename} ·{" "}
                      {(f.sizeBytes / (1024 * 1024)).toFixed(2)} MB · uploaded{" "}
                      {formatIssueDetailTime(new Date(f.uploadedAt).getTime())}
                    </p>
                  </div>
                  <form
                    method="post"
                    action={`/p/${projectId}/debug-files/${f.id}/delete`}
                    {...({
                      onsubmit:
                        "return confirm('この dSYM を削除します。元に戻せません。続行しますか？');",
                    } as Record<string, unknown>)}
                  >
                    <ButtonDestructiveOutline type="submit">
                      削除
                    </ButtonDestructiveOutline>
                  </form>
                </li>
              ))
            )}
          </ul>
        </Card>
        </div>
      ) : null}

      {isAdmin ? (
        <Card className="border border-rose-500/30 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-rose-400">
            Danger zone
          </h2>
          <p className="mt-2 text-sm text-kumo-subtle">
            プロジェクトを削除すると、保存済みの全 issue・event・ペイロード・API
            キーが
            <span className="font-semibold text-rose-400">完全に削除</span>
            され、元に戻せません。確認のためプロジェクト ID
            <code className="mx-1 font-mono text-kumo-default">{projectId}</code>
            を入力してください。
          </p>
          <form
            method="post"
            action={`/p/${projectId}/delete`}
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="flex-1">
              <InputField
                label="プロジェクト ID を入力"
                name="confirm"
                placeholder={projectId}
                mono
                required
              />
            </div>
            <ButtonDestructiveOutline type="submit">
              プロジェクトを完全に削除
            </ButtonDestructiveOutline>
          </form>
        </Card>
      ) : null}
    </Shell>,
    { title: `${project.name} — Settings — Wana` }
  );
});

/** Update retention + monthly quota. admin+ only — checked inside the service. */
projectsRoute.post("/:projectId/quota", async (c) => {
  const projectId = c.req.param("projectId");
  const uid = getDashboardUserId(c);
  if (!uid) return c.redirect("/login");
  const project = await getProjectRow(c.env.DB_CONTROL, projectId);
  if (!project) return c.redirect("/");
  const body = await c.req.parseBody();
  const retention = Number(body.retention_days);
  const quotaRaw = String(body.max_events_per_month ?? "").trim();
  const quota = quotaRaw === "" ? null : Number(quotaRaw);
  if (!Number.isFinite(retention) || retention < 1 || retention > 365) {
    return c.redirect(
      `/p/${projectId}/settings?err=${encodeURIComponent("保持期間は 1〜365 の整数で指定してください")}`
    );
  }
  if (quota !== null && (!Number.isFinite(quota) || quota < 1)) {
    return c.redirect(
      `/p/${projectId}/settings?err=${encodeURIComponent("月間上限は 1 以上の整数 or 空欄で指定してください")}`
    );
  }
  try {
    await updateProjectQuota(c.env.DB_CONTROL, {
      projectId,
      actingUserId: uid,
      retentionDays: retention,
      maxEventsPerMonth: quota,
    });
    // Mirror the retention value into the DO so its alarm picks it up
    // without re-fetching the control-plane row.
    const id = durableObjectIdForStoredProject(c.env.PROJECT_DO, project.doId);
    const store = c.env.PROJECT_DO.get(id);
    await store.setRetentionDays(retention);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "保存に失敗しました";
    return c.redirect(`/p/${projectId}/settings?err=${encodeURIComponent(msg)}`);
  }
  return c.redirect(
    `/p/${projectId}/settings?ok=${encodeURIComponent("プロジェクト設定を保存しました")}`
  );
});

projectsRoute.post("/:projectId/keys", async (c) => {
  const projectId = c.req.param("projectId");
  const uid = getDashboardUserId(c);
  if (!uid) return c.redirect("/login");
  try {
    const { plainKey } = await issueApiKeyForProject(
      c.env.DB_CONTROL,
      projectId,
      uid
    );
    return c.redirect(
      `/p/${projectId}/settings?key=${encodeURIComponent(plainKey)}`
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "発行に失敗しました";
    return c.redirect(`/p/${projectId}/settings?err=${encodeURIComponent(msg)}`);
  }
});

projectsRoute.post("/:projectId/keys/:keyId/toggle", async (c) => {
  const projectId = c.req.param("projectId");
  const keyId = c.req.param("keyId");
  const uid = getDashboardUserId(c);
  if (!uid) return c.redirect("/login");
  const body = await c.req.parseBody();
  const active = String(body.active ?? "") === "true";
  try {
    await setApiKeyActive(c.env.DB_CONTROL, projectId, keyId, active, uid);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "変更に失敗しました";
    return c.redirect(`/p/${projectId}/settings?err=${encodeURIComponent(msg)}`);
  }
  return c.redirect(`/p/${projectId}/settings`);
});

projectsRoute.post("/:projectId/delete", async (c) => {
  const projectId = c.req.param("projectId");
  const uid = getDashboardUserId(c);
  if (!uid) return c.redirect("/login");

  const project = await getProjectRow(c.env.DB_CONTROL, projectId);
  if (!project) return c.redirect("/");

  const body = await c.req.parseBody();
  if (String(body.confirm ?? "") !== projectId) {
    return c.redirect(
      `/p/${projectId}/settings?err=${encodeURIComponent(
        "確認のプロジェクト ID が一致しません"
      )}`
    );
  }

  // Purge data-plane first (DO + R2), then control-plane rows. RBAC is enforced
  // in deleteProject; do the authz check before touching the DO.
  const role = await getProjectRoleForUser(c.env.DB_CONTROL, uid, projectId);
  if (!role || !orgRoleAtLeast(role, "admin")) {
    return c.redirect(
      `/p/${projectId}/settings?err=${encodeURIComponent("権限がありません")}`
    );
  }

  try {
    const id = durableObjectIdForStoredProject(c.env.PROJECT_DO, project.doId);
    const store = c.env.PROJECT_DO.get(id);
    await store.purgeAllData();
    await deleteProject(c.env.DB_CONTROL, projectId, uid);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "削除に失敗しました";
    return c.redirect(`/p/${projectId}/settings?err=${encodeURIComponent(msg)}`);
  }
  return c.redirect("/?ok=deleted");
});

// ── Debug files (dSYM upload) ──────────────────────────────────────────

/**
 * Verify a request carries a valid DSN public key for `projectId` (the
 * same secret iOS / Cocoa SDKs pass on `/api/<id>/envelope/`). Used by
 * the `wana upload-dif` CLI so developers don't need to mint a separate
 * upload token — the DSN they already configured for the SDK is the
 * same secret that authenticates dSYM uploads.
 */
async function dsnAuthMatchesProject(
  env: Env,
  req: { header: (n: string) => string | undefined; query: (n: string) => string | unknown },
  projectId: string
): Promise<boolean> {
  const key = extractSentryKeyFromRequest(req);
  if (!key) return false;
  const keyHash = await hashHex(key);
  const db = drizzle(env.DB_CONTROL);
  const rows = await db
    .select({ isActive: apiKeysTable.isActive })
    .from(apiKeysTable)
    .innerJoin(projectsTable, eq(apiKeysTable.projectId, projectsTable.id))
    .where(
      and(eq(apiKeysTable.keyHash, keyHash), eq(projectsTable.id, projectId))
    )
    .limit(1);
  return rows[0]?.isActive === true;
}

/**
 * Detect whether a request originates from the CLI vs. a logged-in browser.
 * CLI sends `X-Sentry-Auth` or `Authorization` (DSN); browser sends nothing
 * and relies on session cookies. We respond with JSON for CLI, redirects
 * for browser.
 */
function isCliRequest(c: { req: { header: (n: string) => string | undefined } }): boolean {
  return Boolean(c.req.header("X-Sentry-Auth") || c.req.header("Authorization"));
}

projectsRoute.post("/:projectId/debug-files", async (c) => {
  // The URL segment means different things per caller: the CLI reaches this
  // route via the DSN it was given (numeric external id), while the browser
  // form posts the project's slug id. Resolve each to the same canonical
  // `project.id` up front so R2 keys / redirects agree regardless of caller.
  const idParam = c.req.param("projectId");
  const cli = isCliRequest(c);

  // Two auth paths: CLI (Bearer DSN) → 401 JSON on failure; browser (session
  // cookie + admin role) → redirect to /login on failure. Both end up
  // hitting the same insert path below.
  let uid: string | null = null;
  let project: Awaited<ReturnType<typeof getProjectRow>> | undefined;
  if (cli) {
    project = await getProjectRowByExternalId(c.env.DB_CONTROL, idParam);
    if (!project) {
      return c.json({ ok: false, error: "project_not_found" }, 404);
    }
    const ok = await dsnAuthMatchesProject(c.env, c.req, project.id);
    if (!ok) return c.json({ ok: false, error: "invalid_dsn" }, 401);
  } else {
    uid = getDashboardUserId(c);
    if (!uid) return c.redirect("/login");
    const role = await getProjectRoleForUser(c.env.DB_CONTROL, uid, idParam);
    if (!role || !orgRoleAtLeast(role, "admin")) {
      return c.redirect(
        `/p/${idParam}/settings?err=${encodeURIComponent("dSYM のアップロードには admin 以上が必要です")}`
      );
    }
    project = await getProjectRow(c.env.DB_CONTROL, idParam);
    if (!project) return c.redirect("/");
  }
  const projectId = project.id;

  const fail = (msg: string, status = 400): Response =>
    cli
      ? c.json({ ok: false, error: msg }, status as 400 | 401 | 404 | 413 | 422)
      : c.redirect(`/p/${projectId}/settings?err=${encodeURIComponent(msg)}`);

  // Workers / Pages cap request bodies at 100 MB (free) / 500 MB (paid).
  // Large dSYMs (game apps) routinely exceed that; we cap at 90 MB now,
  // and the "Direct R2 upload via presigned URL" path is P2.
  const MAX = 90 * 1024 * 1024;
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch (e) {
    return fail(
      "multipart 解析に失敗しました: " + (e instanceof Error ? e.message : "")
    );
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return fail("ファイルが選択されていません");
  }
  if (file.size > MAX) {
    return fail(
      `ファイルサイズが上限 (${Math.floor(MAX / (1024 * 1024))} MB) を超えています`,
      413
    );
  }

  // Optional git context — set by `wana upload-dif` when invoked inside a
  // git checkout with a known remote. Validated minimally (length + char
  // class) so we don't store garbage from a bad client.
  const rawSha = String(form.get("git_sha") ?? "").trim();
  const rawRepo = String(form.get("git_repo") ?? "").trim();
  const gitSha = /^[0-9a-f]{7,64}$/i.test(rawSha) ? rawSha.toLowerCase() : null;
  const gitRepo =
    /^[A-Za-z0-9._-]{1,80}\/[A-Za-z0-9._-]{1,100}$/.test(rawRepo)
      ? rawRepo
      : null;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = extractMachOUuid(bytes);
  if (!info) {
    return fail(
      "Mach-O DWARF として認識できません。dSYM 内 Contents/Resources/DWARF/<binary> を直接アップロードしてください",
      422
    );
  }

  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 200);
  const r2Key = `debug-files/${encodeURIComponent(projectId)}/${info.uuid}/${safeName || "dwarf"}`;
  await c.env.PAYLOAD_STORAGE.put(r2Key, bytes, {
    httpMetadata: { contentType: "application/octet-stream" },
  });

  const doId = durableObjectIdForStoredProject(c.env.PROJECT_DO, project.doId);
  const store = c.env.PROJECT_DO.get(doId);
  let replacedR2Key: string | null = null;
  try {
    const result = await store.insertDebugFile({
      uuid: info.uuid,
      arch: info.arch,
      originalFilename: safeName,
      r2Key,
      sizeBytes: bytes.length,
      uploadedByUserId: uid,
      gitSha,
      gitRepo,
    });
    replacedR2Key = result.replacedR2Key;
  } catch (e) {
    // Roll back R2 write so we don't leave an orphan if DO insert fails.
    await c.env.PAYLOAD_STORAGE.delete(r2Key).catch(() => {});
    return fail(e instanceof Error ? e.message : "DO insert failed", 500);
  }
  // Old r2Key for this UUID is now orphaned — purge so we don't double-store.
  if (replacedR2Key && replacedR2Key !== r2Key) {
    await c.env.PAYLOAD_STORAGE.delete(replacedR2Key).catch(() => {});
  }

  if (cli) {
    return c.json({
      ok: true,
      uuid: info.uuid,
      arch: info.arch,
      replaced: Boolean(replacedR2Key && replacedR2Key !== r2Key),
      gitSha,
      gitRepo,
    });
  }
  return c.redirect(
    `/p/${projectId}/settings?ok=${encodeURIComponent(
      `dSYM (uuid=${info.uuid.slice(0, 8)}…) をアップロードしました`
    )}`
  );
});

projectsRoute.post("/:projectId/debug-files/:fileId/delete", async (c) => {
  const projectId = c.req.param("projectId");
  const fileId = c.req.param("fileId");
  const uid = getDashboardUserId(c);
  if (!uid) return c.redirect("/login");
  const role = await getProjectRoleForUser(c.env.DB_CONTROL, uid, projectId);
  if (!role || !orgRoleAtLeast(role, "admin")) {
    return c.redirect(
      `/p/${projectId}/settings?err=${encodeURIComponent("削除には admin 以上が必要です")}`
    );
  }
  const project = await getProjectRow(c.env.DB_CONTROL, projectId);
  if (!project) return c.redirect("/");
  const doId = durableObjectIdForStoredProject(c.env.PROJECT_DO, project.doId);
  const store = c.env.PROJECT_DO.get(doId);
  const { r2Key } = await store.deleteDebugFile(fileId);
  if (r2Key) {
    await c.env.PAYLOAD_STORAGE.delete(r2Key).catch(() => {});
  }
  return c.redirect(
    `/p/${projectId}/settings?ok=${encodeURIComponent("dSYM を削除しました")}`
  );
});

projectsRoute.get("/:projectId/issues/:issueId", async (c) => {
  const projectId = c.req.param("projectId");
  const issueId = c.req.param("issueId");
  const uid = getDashboardUserId(c);
  if (!uid) {
    return c.redirect("/login");
  }

  const sidebar = await loadShellSidebar(c, uid);
  const project = await getProjectRow(c.env.DB_CONTROL, projectId);
  if (!project) {
    return c.render(
      <NotFoundShell
        currentPath={c.req.path}
        title="Not found"
        message="Project not found."
        backHref="/"
        backLabel="← All projects"
        {...sidebar}
      />,
      { title: "Not found — Wana" }
    );
  }

  if (!(await userCanAccessProject(c.env.DB_CONTROL, uid, projectId))) {
    return c.render(
      <NotFoundShell
        currentPath={c.req.path}
        title="Not found"
        message="Project not found."
        backHref="/"
        backLabel="← All projects"
        {...sidebar}
      />,
      { title: "Not found — Wana" }
    );
  }

  const id = durableObjectIdForStoredProject(c.env.PROJECT_DO, project.doId);
  const store = c.env.PROJECT_DO.get(id);
  const issue = await store.getIssue(issueId);
  if (!issue) {
    return c.render(
      <NotFoundShell
        currentPath={c.req.path}
        title="Not found"
        message="Issue not found."
        backHref={`/p/${projectId}`}
        backLabel={`← ${project.name}`}
        {...sidebar}
        currentProject={{ id: project.id, name: project.name }}
      />,
      { title: "Not found — Wana" }
    );
  }

  const projectMembers = await listProjectMembersForAssignee(
    c.env.DB_CONTROL,
    projectId
  );
  const viewerRole = await getProjectRoleForUser(
    c.env.DB_CONTROL,
    uid,
    projectId
  );
  const isAdminViewer = viewerRole
    ? orgRoleAtLeast(viewerRole, "admin")
    : false;
  const [eventRows, latestTags, issueHistogram] = await Promise.all([
    store.getEvents(issueId, { limit: 20 }),
    store.getLatestEventTags(issueId),
    store.getEventHistogram({ hours: 24, issueId }),
  ]);
  // Split out of Promise.all + explicit re-typing — the DO RPC type
  // serialization collapses the discriminated union return type to
  // `never` on the dashboard side.
  type TimelineComment = {
    kind: "comment";
    id: string;
    authorUserId: string;
    body: string;
    createdAtMs: number;
    updatedAtMs: number | null;
  };
  type TimelineActivity = {
    kind: "activity";
    id: string;
    actorUserId: string | null;
    activityKind: string;
    payload: Record<string, unknown> | null;
    createdAtMs: number;
  };
  const timeline = (await store.getIssueTimeline(
    issueId,
    200
  )) as Array<TimelineComment | TimelineActivity>;
  const issueHistogramTotal = issueHistogram.reduce(
    (acc, b) => acc + b.count,
    0
  );
  let payloadPreview: string | null = null;
  let symbolsFile: SymbolsFile | null = null;
  const latest = eventRows[0];
  if (latest) {
    // Fetch payload + symbols.json in parallel — the symbols.json may be
    // absent (non-native event, or symbolicate failed/pending), in which
    // case we just render the raw frames.
    const [payloadObj, symbolsObj] = await Promise.all([
      c.env.PAYLOAD_STORAGE.get(latest.r2PayloadKey),
      c.env.PAYLOAD_STORAGE.get(`${latest.r2PayloadKey}.symbols.json`),
    ]);
    if (payloadObj) {
      payloadPreview = await payloadObj.text();
    }
    if (symbolsObj) {
      try {
        const text = await symbolsObj.text();
        const parsed = JSON.parse(text) as unknown;
        if (
          parsed &&
          typeof parsed === "object" &&
          "symbolsByUuid" in parsed
        ) {
          symbolsFile = parsed as SymbolsFile;
        }
      } catch {
        // Malformed symbols.json — fall through to raw frames.
      }
    }
  }
  const rawPayload = payloadPreview
    ? parseStoredEventPayload(payloadPreview)
    : null;
  const merged = rawPayload
    ? mergeSymbolicatedPayload(rawPayload, symbolsFile)
    : null;
  const parsedPayload = merged?.payload ?? rawPayload;

  // Build uuid → { gitSha, gitRepo } map for frame-to-GitHub linking +
  // a set of UUIDs that have NO debug-file row (so we can prompt the
  // user to upload). The CLI captures git context at upload time.
  let gitContextByUuid: Record<string, { gitSha: string; gitRepo: string }> = {};
  let missingDsymUuids: string[] = [];
  const imageUuids = (parsedPayload?.debug_meta?.images ?? [])
    .map((img) => (img.debug_id ?? img.code_id ?? "").replace(/-/g, "").toLowerCase())
    .filter((u) => /^[0-9a-f]{32}$/.test(u));
  if (imageUuids.length > 0) {
    try {
      const meta = await store.findDebugFileMetaByUuids(imageUuids);
      // Only mark as "missing" the UUIDs that an in-app frame actually
      // references — system frameworks (UIKitCore, dyld, …) are out of
      // scope for upload and would just clutter the prompt.
      const inAppUuids = new Set<string>();
      const collect = (frames: { _wanaImageUuid?: string; in_app?: boolean }[] | undefined): void => {
        if (!frames) return;
        for (const f of frames) {
          if (f.in_app !== false && f._wanaImageUuid) inAppUuids.add(f._wanaImageUuid);
        }
      };
      for (const ex of parsedPayload?.exception?.values ?? []) collect(ex.stacktrace?.frames);
      const threads = (parsedPayload as unknown as {
        threads?: { values?: Array<{ stacktrace?: { frames?: { _wanaImageUuid?: string; in_app?: boolean }[] } }> };
      })?.threads?.values;
      if (Array.isArray(threads)) {
        for (const t of threads) collect(t.stacktrace?.frames);
      }
      missingDsymUuids = [...inAppUuids].filter((u) => !(u in meta));
      for (const [u, m] of Object.entries(meta)) {
        if (m.gitSha && m.gitRepo) {
          gitContextByUuid[u] = { gitSha: m.gitSha, gitRepo: m.gitRepo };
        }
      }
    } catch {
      // Best-effort — older DOs without this RPC just don't show links.
    }
  }
  const symbolicateSummary =
    merged && merged.totalNative > 0
      ? {
          resolved: merged.resolved,
          totalNative: merged.totalNative,
          pending: !symbolsFile,
        }
      : undefined;
  const resymbolicateAction = latest
    ? `/p/${projectId}/issues/${issueId}/events/${latest.id}/symbolicate`
    : undefined;

  const statusFormBase = `/p/${projectId}/issues/${issueId}/status`;

  return c.render(
    <Shell
      currentPath={c.req.path}
      title={issue.value}
      auth="signed-in"
      {...sidebar}
      currentProject={{ id: project.id, name: project.name }}
    >
      <div className="mb-8">
        <TextLink href={`/p/${projectId}`}>← {project.name}</TextLink>
      </div>

      <PageHeader
        title={issue.value}
        description={
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-semibold text-kumo-default">{issue.type}</span>
              <span className="text-kumo-subtle">|</span>
              <span className="max-w-xl truncate font-mono text-xs text-kumo-subtle">
                {issue.culprit ?? "—"}
              </span>
              <span className="text-kumo-subtle">|</span>
              <span
                className="font-mono text-xs text-kumo-subtle"
                title={issue.id}
              >
                {issue.id.length > 12
                  ? `${issue.id.slice(0, 8)}…${issue.id.slice(-4)}`
                  : issue.id}
              </span>
            </div>
          </div>
        }
      />

      <div className="mb-10 grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
            Status
          </div>
          <IssueStatusToolbar action={statusFormBase} status={issue.status} />
          <div className="mt-5 border-t border-kumo-hairline pt-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
              Assignee
            </div>
            <form
              method="post"
              action={`/p/${projectId}/issues/${issueId}/assign`}
              className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center"
            >
              <select
                name="assignee"
                defaultValue={issue.assigneeUserId ?? ""}
                className="h-9 flex-1 rounded-md border border-kumo-hairline bg-kumo-recessed px-2 text-sm text-kumo-default focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
              >
                <option value="">— 未割り当て —</option>
                {projectMembers.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name || m.email}
                  </option>
                ))}
              </select>
              <ButtonSecondary type="submit">更新</ButtonSecondary>
            </form>
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
            Events
          </div>
          <div className="mt-2 text-2xl font-semibold tabular-nums text-kumo-default">
            {issue.eventsCount}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Sparkline24h buckets={issueHistogram} width={140} height={32} />
            <span className="text-[11px] text-kumo-subtle">
              24h: {issueHistogramTotal}
            </span>
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
            First seen
          </div>
          <div className="mt-1 text-sm tabular-nums text-kumo-default">
            {formatIssueDetailTime(new Date(issue.firstSeen).getTime())}
          </div>
          <div className="mt-4 border-t border-kumo-hairline pt-3 text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
            Last seen
          </div>
          <div className="mt-1 text-sm tabular-nums text-kumo-default">
            {formatIssueDetailTime(new Date(issue.lastSeen).getTime())}
          </div>
        </Card>
      </div>

      <IssueTagsCard projectId={projectId} tags={latestTags} />

      <Card className="mb-10 p-5">
        <div className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
          Fingerprint
        </div>
        <div className="mt-2 break-all font-mono text-xs leading-relaxed text-kumo-subtle">
          {issue.fingerprint}
        </div>
      </Card>

      <Card className="mb-10 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-rose-500/90">
              Danger zone
            </h3>
            <p className="text-xs text-kumo-subtle">
              この issue とイベント・R2 ペイロード・タグ行を完全に削除します。元に戻せません。
            </p>
          </div>
          <form
            method="post"
            action={`/p/${projectId}/issues/${issueId}/delete`}
            // SSR-only inline confirm. React's typed prop is `onSubmit` (a
            // handler function); for native HTML string attrs we spread to
            // bypass the typings and ship a tiny inline guard.
            {...({
              onsubmit:
                "return confirm('この issue を削除します。元に戻せません。続行しますか？');",
            } as Record<string, unknown>)}
          >
            <ButtonDestructiveOutline type="submit">
              Issue を削除
            </ButtonDestructiveOutline>
          </form>
        </div>
      </Card>

      <h2
        id="timeline"
        className="mb-4 text-xs font-semibold uppercase tracking-wider text-kumo-subtle"
      >
        タイムライン
      </h2>
      <Card className="mb-6 p-5">
        <form
          method="post"
          action={`/p/${projectId}/issues/${issueId}/comments`}
          className="space-y-3"
        >
          <textarea
            name="body"
            placeholder="コメントを入力（プレーンテキスト、最大 8000 文字）"
            rows={3}
            className="w-full rounded-md border border-kumo-hairline bg-kumo-recessed px-3 py-2 text-sm text-kumo-default placeholder:text-kumo-subtle focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
            required
          />
          <ButtonPrimary type="submit">コメント</ButtonPrimary>
        </form>
        {timeline.length === 0 ? (
          <p className="mt-6 text-sm text-kumo-subtle">
            まだコメントもアクションもありません。
          </p>
        ) : (
          <ul className="mt-6 space-y-4">
            {timeline.map((item) => {
              const actor =
                item.kind === "comment" ? item.authorUserId : item.actorUserId;
              const actorLabel = actor
                ? projectMembers.find((m) => m.userId === actor)?.name ||
                  projectMembers.find((m) => m.userId === actor)?.email ||
                  actor.slice(0, 8)
                : "システム";
              return (
                <li
                  key={item.id}
                  className="border-l-2 border-kumo-hairline pl-4"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-kumo-subtle">
                    <span className="font-medium text-kumo-default">
                      {actorLabel}
                    </span>
                    {item.kind === "comment" ? (
                      <Badge variant="zinc">コメント</Badge>
                    ) : (
                      <Badge variant="zinc">
                        {timelineActivityLabel(
                          item.activityKind,
                          item.payload,
                          projectMembers
                        )}
                      </Badge>
                    )}
                    <span className="font-mono tabular-nums">
                      {formatIssueDetailTime(item.createdAtMs)}
                    </span>
                    {item.kind === "comment" &&
                    (item.authorUserId === uid || isAdminViewer) ? (
                      <form
                        method="post"
                        action={`/p/${projectId}/issues/${issueId}/comments/${item.id}/delete`}
                        className="ml-auto"
                      >
                        <button
                          type="submit"
                          className="text-[11px] text-kumo-subtle hover:text-rose-500"
                        >
                          削除
                        </button>
                      </form>
                    ) : null}
                  </div>
                  {item.kind === "comment" ? (
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-kumo-default">
                      {item.body}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
        Events in this issue
      </h2>
      <Card className="mb-10 overflow-hidden">
        {eventRows.length === 0 ? (
          <p className="p-6 text-sm text-kumo-subtle">No events recorded.</p>
        ) : (
          <>
            <div
              className="hidden grid-cols-[minmax(8rem,1fr)_12rem_6rem_1fr] gap-3 border-b border-kumo-hairline px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-kumo-subtle sm:grid sm:px-6"
              role="row"
            >
              <div>Event ID</div>
              <div>Timestamp</div>
              <div>Environment</div>
              <div>Release</div>
            </div>
            <ul className="divide-y divide-kumo-hairline">
              {eventRows.map((e) => (
                <li
                  key={e.id}
                  className="grid gap-2 px-5 py-3 text-xs sm:grid-cols-[minmax(8rem,1fr)_12rem_6rem_1fr] sm:items-center sm:gap-3 sm:px-6"
                >
                  <span
                    className="font-mono text-kumo-default"
                    title={e.id}
                  >
                    {e.id.length > 12
                      ? `${e.id.slice(0, 8)}…${e.id.slice(-4)}`
                      : e.id}
                  </span>
                  <span className="tabular-nums text-kumo-subtle">
                    {formatIssueDetailTime(new Date(e.timestamp).getTime())}
                  </span>
                  <span className="text-kumo-subtle">{e.environment ?? "—"}</span>
                  <span className="truncate text-kumo-subtle">{e.release ?? "—"}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
        Latest event
      </h2>
      {parsedPayload ? (
        <Card className="mb-10 overflow-hidden">
          <EventPayloadView
            payload={parsedPayload}
            symbolicate={symbolicateSummary}
            resymbolicateAction={resymbolicateAction}
            gitContextByUuid={gitContextByUuid}
            missingDsymUuids={missingDsymUuids}
            uploadDsymHref={`/p/${projectId}/settings#debug-files`}
            guideHref="/"
          />
        </Card>
      ) : null}

      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
        Raw JSON payload
      </h2>
      <Card className="overflow-hidden">
        {payloadPreview ? (
          <details>
            <summary className="cursor-pointer px-5 py-3 text-sm text-kumo-subtle hover:text-kumo-default sm:px-6">
              {parsedPayload
                ? "保存済み JSON を表示"
                : "保存済み JSON（イベントの解析に失敗しました）"}
            </summary>
            <pre className="max-h-112 overflow-auto border-t border-kumo-hairline p-5 font-mono text-xs leading-relaxed text-kumo-default sm:p-6">
              {payloadPreview}
            </pre>
          </details>
        ) : (
          <p className="p-6 text-sm text-kumo-subtle">
            最新イベントのペイロードは保存されていません。
          </p>
        )}
      </Card>
    </Shell>,
    { title: `${issue.value} — Wana` }
  );
});

// Mount notifications sub-routes (own file to keep this one from growing more).
import { notificationsRoute } from "./notifications";
projectsRoute.route("/", notificationsRoute);

export default projectsRoute;
