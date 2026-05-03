import { Hono } from "hono";

import type { IssueStatus } from "@wana/types";

import {
  getProjectRow,
  userCanAccessProject,
} from "../data/control-plane";
import { getProjectDataStore } from "../lib/durable-object";
import { dashboardUserId, playgroundHref } from "../lib/dashboard-user";
import { projectIssuesLiveScript } from "../lib/project-issues-live";
import {
  parseIssueStreamQuery,
  issueStreamQueryParam,
  formatIssueDetailTime,
  issueStreamTabHref,
  isIssueStreamTabActive,
  formatIssueStreamRelativeTime,
  type IssueStreamFilter,
} from "../lib/issue-stream";
import {
  Badge,
  Card,
  IssueStatusToolbar,
  LinkGhost,
  PageHeader,
  TextLink,
  issueStatusVariant,
} from "../ui/components";
import { Shell } from "../ui/shell";
import type { Env } from "../types/bindings";
import type { ProjectDataStore } from "@wana/worker/project-store";

export const projectsRoute = new Hono<{ Bindings: Env }>();

type IssueStreamRow = Awaited<
  ReturnType<ProjectDataStore["getIssues"]>
>[number];

function issueStreamTabClass(active: boolean): string {
  const base =
    "inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-1 py-2 text-sm font-medium transition-colors";
  return active
    ? `${base} border-amber-500 text-zinc-100`
    : `${base} border-transparent text-zinc-500 hover:border-zinc-600 hover:text-zinc-300`;
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
      class="mb-1 flex flex-wrap gap-x-4 gap-y-1 border-b border-zinc-800/90"
      aria-label="Issue stream filters"
    >
      {tabs.map((t) => (
        <a
          class={issueStreamTabClass(isIssueStreamTabActive(active, t.filter))}
          href={issueStreamTabHref(projectId, t.filter)}
        >
          {t.label}
          <span class="tabular-nums text-xs font-normal text-zinc-500">
            {t.n}
          </span>
        </a>
      ))}
    </nav>
  );
}

function IssueStreamQueryBar(props: { queryParam: string }) {
  return (
    <div class="mb-4 flex items-center gap-2 rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-3 py-2">
      <span class="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Filter
      </span>
      <code class="rounded bg-zinc-900/80 px-2 py-0.5 font-mono text-xs text-amber-400/90">
        {props.queryParam}
      </code>
      <span class="text-xs text-zinc-600">
        (Sentry-style stream; search bar is planned.)
      </span>
    </div>
  );
}

function IssueStreamTable(props: { projectId: string; rows: IssueStreamRow[] }) {
  const { projectId, rows } = props;

  return (
    <div class="wana-issue-stream divide-y divide-zinc-800/80">
      <div
        class="hidden gap-0 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 sm:grid sm:grid-cols-[minmax(0,1fr)_7rem_5rem_6.5rem]"
        role="row"
      >
        <div class="pr-4">Issue</div>
        <div class="text-right">Last seen</div>
        <div class="text-right">Events</div>
        <div class="text-right">Status</div>
      </div>
      {rows.map((row) => (
        <a
          class="group grid gap-3 px-5 py-4 transition-colors hover:bg-zinc-800/25 sm:grid-cols-[minmax(0,1fr)_7rem_5rem_6.5rem] sm:items-center sm:gap-0"
          href={`/p/${projectId}/issues/${row.id}`}
        >
          <div class="min-w-0 space-y-1 pr-4">
            <p class="text-[15px] font-semibold leading-snug text-zinc-100 group-hover:text-amber-400">
              {row.value}
            </p>
            <p class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500">
              <span class="font-medium text-zinc-400">{row.type}</span>
              <span class="text-zinc-600" aria-hidden="true">
                |
              </span>
              <span class="truncate font-mono text-[11px] text-zinc-600">
                {row.culprit ?? "—"}
              </span>
            </p>
          </div>
          <div class="text-left text-xs tabular-nums text-zinc-400 sm:text-right">
            <span class="sm:hidden text-zinc-600">Last seen: </span>
            {formatIssueStreamRelativeTime(row.lastSeen.getTime())}
          </div>
          <div class="text-left text-xs tabular-nums text-zinc-400 sm:text-right">
            <span class="sm:hidden text-zinc-600">Events: </span>
            {row.eventsCount}
          </div>
          <div class="flex sm:justify-end">
            <Badge variant={issueStatusVariant(row.status)}>{row.status}</Badge>
          </div>
        </a>
      ))}
    </div>
  );
}

function IssueStreamEmpty(props: {
  kind: "none" | "filtered";
  filter: IssueStreamFilter;
}) {
  if (props.kind === "none") {
    return (
      <div class="px-6 py-14 text-center">
        <p class="text-sm text-zinc-500">
          No issues yet. Send events from the Sentry SDK to the ingest worker,
          or use the Sentry browser test page linked in the footer.
        </p>
      </div>
    );
  }

  const label =
    props.filter.kind === "all"
      ? "No issues in this project."
      : props.filter.status === "unresolved"
        ? "There are no unresolved issues."
        : props.filter.status === "resolved"
          ? "There are no resolved issues."
          : "There are no ignored issues.";

  return (
    <div class="px-6 py-14 text-center">
      <p class="text-sm text-zinc-500">{label}</p>
      <p class="mt-2 text-xs text-zinc-600">
        Adjust the tabs above or change issue status from an issue detail page.
      </p>
    </div>
  );
}

/** Durable Object hibernating WebSocket — proxied from browser after access check. */
projectsRoute.get("/:projectId/ws", async (c) => {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.text("Expected WebSocket Upgrade", 426);
  }

  const projectId = c.req.param("projectId");
  const uid = dashboardUserId(c.env);

  const project = await getProjectRow(c.env.DB_CONTROL, projectId);
  if (!project) {
    return c.text("Forbidden", 403);
  }
  if (!(await userCanAccessProject(c.env.DB_CONTROL, uid, projectId))) {
    return c.text("Forbidden", 403);
  }

  const stub = getProjectDataStore(c.env, project.doId);
  return stub.fetch(c.req.raw as never) as unknown as Promise<Response>;
});

function NotFoundShell(props: {
  title: string;
  message: string;
  backHref: string;
  backLabel: string;
  playgroundUrl?: string;
}) {
  return (
    <Shell title={props.title} playgroundUrl={props.playgroundUrl}>
      <Card class="p-8 text-center">
        <p class="text-zinc-400">{props.message}</p>
        <div class="mt-6">
          <TextLink href={props.backHref}>{props.backLabel}</TextLink>
        </div>
      </Card>
    </Shell>
  );
}

projectsRoute.get("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const uid = dashboardUserId(c.env);
  const pg = playgroundHref(c.env);

  const project = await getProjectRow(c.env.DB_CONTROL, projectId);
  if (!project) {
    return c.render(
      <NotFoundShell
        title="Not found"
        message="Project not found."
        backHref="/"
        backLabel="← All projects"
        playgroundUrl={pg}
      />
    );
  }

  if (!(await userCanAccessProject(c.env.DB_CONTROL, uid, projectId))) {
    return c.render(
      <NotFoundShell
        title="Not found"
        message="Project not found."
        backHref="/"
        backLabel="← All projects"
        playgroundUrl={pg}
      />
    );
  }

  const store = getProjectDataStore(c.env, project.doId);
  const queryRaw = c.req.query("query");
  const streamFilter = parseIssueStreamQuery(queryRaw);
  const tabCounts = await store.getIssueTabCounts();

  const issueRows = await store.getIssues({
    limit: 100,
    ...(streamFilter.kind === "all"
      ? {}
      : { status: streamFilter.status }),
  });

  const streamQueryParam = issueStreamQueryParam(streamFilter);
  const emptyKind =
    tabCounts.all === 0
      ? ("none" as const)
      : issueRows.length === 0
        ? ("filtered" as const)
        : null;

  return c.render(
    <Shell title={project.name} playgroundUrl={pg}>
      <PageHeader
        title={project.name}
        description={
          <span class="font-mono text-xs text-zinc-500">{project.id}</span>
        }
        actions={<LinkGhost href="/">All projects</LinkGhost>}
      />

      <section class="mb-6" aria-labelledby="issue-stream-heading">
        <h2 id="issue-stream-heading" class="sr-only">
          Issues
        </h2>
        <IssueStreamTabs
          active={streamFilter}
          counts={tabCounts}
          projectId={projectId}
        />
        <IssueStreamQueryBar queryParam={streamQueryParam} />

        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-2 sm:gap-3">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Issue stream
            </h3>
            <div
              id="wana-live-indicator"
              class="inline-flex items-center gap-2 rounded-full border border-zinc-700/80 bg-zinc-900/60 px-2.5 py-1"
              role="status"
              aria-live="polite"
            >
              <span
                id="wana-live-dot"
                class="h-2 w-2 shrink-0 rounded-full bg-zinc-600 ring-2 ring-zinc-700/80"
                aria-hidden="true"
              />
              <span
                id="wana-live-label"
                class="text-xs font-medium tabular-nums text-zinc-500"
              >
                準備中…
              </span>
            </div>
            <span id="wana-update-badge" class="hidden" />
          </div>
          <span id="wana-issues-count" class="text-xs tabular-nums text-zinc-600">
            {issueRows.length > 0 ? `${issueRows.length} issues` : ""}
          </span>
        </div>

        <Card class="overflow-hidden">
          <div id="wana-issues-body">
            {emptyKind ? (
              <IssueStreamEmpty filter={streamFilter} kind={emptyKind} />
            ) : (
              <IssueStreamTable projectId={projectId} rows={issueRows} />
            )}
          </div>
        </Card>
      </section>
      <script
        type="text/javascript"
        dangerouslySetInnerHTML={{
          __html: projectIssuesLiveScript(projectId, streamQueryParam),
        }}
      />
    </Shell>
  );
});

projectsRoute.post("/:projectId/issues/:issueId/status", async (c) => {
  const projectId = c.req.param("projectId");
  const issueId = c.req.param("issueId");
  const uid = dashboardUserId(c.env);

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
  const store = getProjectDataStore(c.env, project.doId);
  await store.updateIssueStatus(issueId, status);
  return c.redirect(`/p/${projectId}/issues/${issueId}`);
});

projectsRoute.get("/:projectId/issues/:issueId", async (c) => {
  const projectId = c.req.param("projectId");
  const issueId = c.req.param("issueId");
  const uid = dashboardUserId(c.env);
  const pg = playgroundHref(c.env);

  const project = await getProjectRow(c.env.DB_CONTROL, projectId);
  if (!project) {
    return c.render(
      <NotFoundShell
        title="Not found"
        message="Project not found."
        backHref="/"
        backLabel="← All projects"
        playgroundUrl={pg}
      />
    );
  }

  if (!(await userCanAccessProject(c.env.DB_CONTROL, uid, projectId))) {
    return c.render(
      <NotFoundShell
        title="Not found"
        message="Project not found."
        backHref="/"
        backLabel="← All projects"
        playgroundUrl={pg}
      />
    );
  }

  const store = getProjectDataStore(c.env, project.doId);
  const issue = await store.getIssue(issueId);
  if (!issue) {
    return c.render(
      <NotFoundShell
        title="Not found"
        message="Issue not found."
        backHref={`/p/${projectId}`}
        backLabel={`← ${project.name}`}
        playgroundUrl={pg}
      />
    );
  }

  const eventRows = await store.getEvents(issueId, { limit: 20 });
  let payloadPreview: string | null = null;
  const latest = eventRows[0];
  if (latest) {
    const obj = await c.env.PAYLOAD_STORAGE.get(latest.r2PayloadKey);
    if (obj) {
      payloadPreview = await obj.text();
    }
  }

  const statusFormBase = `/p/${projectId}/issues/${issueId}/status`;

  return c.render(
    <Shell title={issue.value} playgroundUrl={pg}>
      <div class="mb-8">
        <TextLink href={`/p/${projectId}`}>← {project.name}</TextLink>
      </div>

      <PageHeader
        title={issue.value}
        description={
          <div class="flex flex-col gap-2">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span class="font-semibold text-zinc-300">{issue.type}</span>
              <span class="text-zinc-600">|</span>
              <span class="max-w-xl truncate font-mono text-xs text-zinc-500">
                {issue.culprit ?? "—"}
              </span>
              <span class="text-zinc-600">|</span>
              <span class="font-mono text-xs text-zinc-600">{issue.id}</span>
            </div>
          </div>
        }
      />

      <div class="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card class="p-5">
          <div class="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Status
          </div>
          <div class="mt-2">
            <Badge variant={issueStatusVariant(issue.status)}>
              {issue.status}
            </Badge>
          </div>
          <div class="mt-4">
            <IssueStatusToolbar action={statusFormBase} status={issue.status} />
          </div>
        </Card>
        <Card class="p-5">
          <div class="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Events
          </div>
          <div class="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">
            {issue.eventsCount}
          </div>
        </Card>
        <Card class="p-5">
          <div class="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            First seen
          </div>
          <div class="mt-2 text-sm tabular-nums text-zinc-300">
            {formatIssueDetailTime(issue.firstSeen.getTime())}
          </div>
        </Card>
        <Card class="p-5">
          <div class="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Last seen
          </div>
          <div class="mt-2 text-sm tabular-nums text-zinc-300">
            {formatIssueDetailTime(issue.lastSeen.getTime())}
          </div>
        </Card>
      </div>

      <Card class="mb-10 p-5">
        <div class="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Fingerprint
        </div>
        <div class="mt-2 break-all font-mono text-xs leading-relaxed text-zinc-400">
          {issue.fingerprint}
        </div>
      </Card>

      <h2 class="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Events in this issue
      </h2>
      <Card class="mb-10 overflow-hidden">
        {eventRows.length === 0 ? (
          <p class="p-6 text-sm text-zinc-500">No events recorded.</p>
        ) : (
          <>
            <div
              class="hidden grid-cols-[minmax(8rem,1fr)_12rem_6rem_1fr] gap-3 border-b border-zinc-800/80 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 sm:grid sm:px-6"
              role="row"
            >
              <div>Event ID</div>
              <div>Timestamp</div>
              <div>Environment</div>
              <div>Release</div>
            </div>
            <ul class="divide-y divide-zinc-800/80">
              {eventRows.map((e) => (
                <li class="grid gap-2 px-5 py-3 text-xs sm:grid-cols-[minmax(8rem,1fr)_12rem_6rem_1fr] sm:items-center sm:gap-3 sm:px-6">
                  <span class="font-mono text-zinc-300">{e.id}</span>
                  <span class="tabular-nums text-zinc-500">
                    {formatIssueDetailTime(new Date(e.timestamp).getTime())}
                  </span>
                  <span class="text-zinc-500">{e.environment ?? "—"}</span>
                  <span class="truncate text-zinc-500">{e.release ?? "—"}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <h2 class="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        JSON payload (stored object)
      </h2>
      <Card class="overflow-hidden">
        {payloadPreview ? (
          <pre class="max-h-112 overflow-auto p-5 font-mono text-xs leading-relaxed text-zinc-300 sm:p-6">
            {payloadPreview}
          </pre>
        ) : (
          <p class="p-6 text-sm text-zinc-500">
            No payload in R2 for the latest event (key missing or not synced).
          </p>
        )}
      </Card>
    </Shell>
  );
});
