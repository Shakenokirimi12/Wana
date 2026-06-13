import { Hono } from "hono";

import type { IssueStatus } from "@wana/types";

import {
  getProjectRow,
  userCanAccessProject,
  getProjectRoleForUser,
  listApiKeysForProject,
  issueApiKeyForProject,
  setApiKeyActive,
  deleteProject,
} from "@/data/control-plane";
import { orgRoleAtLeast } from "@/data/services/org-service";
import { durableObjectIdForStoredProject } from "@wana/core";
import { getDashboardUserId, playgroundHref } from "@/lib/dashboard-user";
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
  LinkGhost,
  PageHeader,
  TextLink,
  issueStatusVariant,
} from "@/ui/components";
import { Shell } from "@/ui/shell";
import {
  EventPayloadView,
  parseStoredEventPayload,
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
};

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
        placeholder="issue を検索（メッセージ・型・culprit）"
        className="h-9 min-w-[14rem] flex-1 rounded-lg border border-kumo-hairline bg-kumo-recessed px-3 text-sm text-kumo-default placeholder:text-kumo-subtle focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
      />
      <ButtonSecondary type="submit">検索</ButtonSecondary>
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

function IssueStreamTable(props: { projectId: string; rows: IssueStreamRow[] }) {
  const { projectId, rows } = props;

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

function IssueStreamEmpty(props: {
  kind: "none" | "filtered";
  filter: IssueStreamFilter;
}) {
  if (props.kind === "none") {
    return (
      <div className="px-6 py-14 text-center">
        <p className="text-sm text-kumo-subtle">
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
    <div className="px-6 py-14 text-center">
      <p className="text-sm text-kumo-subtle">{label}</p>
      <p className="mt-2 text-xs text-kumo-subtle">
        Adjust the tabs above or change issue status from an issue detail page.
      </p>
    </div>
  );
}

/** Browser loads this as a classic script (React ではインライン script が実行されないことがある). */
projectsRoute.get("/:projectId/live.js", async (c) => {
  const projectId = c.req.param("projectId");
  const streamQuery = c.req.query("q") ?? "";
  const search = c.req.query("search") ?? "";
  const js = projectIssuesLiveScript(projectId, streamQuery, search);
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
  playgroundUrl?: string;
}) {
  return (
    <Shell title={props.title} playgroundUrl={props.playgroundUrl} auth="signed-in">
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
      />,
      { title: "Not found — Wana" }
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
      />,
      { title: "Not found — Wana" }
    );
  }

  const id = durableObjectIdForStoredProject(c.env.PROJECT_DO, project.doId);
  const store = c.env.PROJECT_DO.get(id);
  const queryRaw = c.req.query("query");
  const streamFilter = parseIssueStreamQuery(queryRaw);
  const tabCounts = await store.getIssueTabCounts();

  const issueRows = await store.getIssues({
    limit: 100,
    ...(streamFilter.kind === "all"
      ? {}
      : { status: streamFilter.status }),
  }) as unknown as IssueStreamRow[];

  const streamQueryParam = issueStreamQueryParam(streamFilter);

  const search = c.req.query("search")?.trim() ?? "";
  const searchLower = search.toLowerCase();
  const streamRows = search
    ? issueRows.filter(
        (r) =>
          r.value.toLowerCase().includes(searchLower) ||
          r.type.toLowerCase().includes(searchLower) ||
          (r.culprit ?? "").toLowerCase().includes(searchLower)
      )
    : issueRows;

  const emptyKind =
    tabCounts.all === 0
      ? ("none" as const)
      : streamRows.length === 0
        ? ("filtered" as const)
        : null;

  return c.render(
    <Shell title={project.name} playgroundUrl={pg} auth="signed-in">
      <PageHeader
        title={project.name}
        description={
          <>
            <span className="text-kumo-subtle">{project.orgName}</span>
            <span className="mx-2 text-kumo-subtle">·</span>
            <Badge variant="zinc">{project.orgSlug}</Badge>
          </>
        }
        actions={
          <>
            <LinkGhost href={`/p/${projectId}/settings`}>Settings</LinkGhost>
            <LinkGhost href="/">All projects</LinkGhost>
          </>
        }
      />

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
                準備中…
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
              <IssueStreamTable projectId={projectId} rows={streamRows} />
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
  await store.updateIssueStatus(issueId, status);
  return c.redirect(`/p/${projectId}/issues/${issueId}`);
});

/** Project settings: API key management + danger zone (delete). admin+ only. */
projectsRoute.get("/:projectId/settings", async (c) => {
  const projectId = c.req.param("projectId");
  const uid = getDashboardUserId(c);
  const pg = playgroundHref(c.env);
  if (!uid) return c.redirect("/login");

  const project = await getProjectRow(c.env.DB_CONTROL, projectId);
  if (!project) {
    return c.render(
      <NotFoundShell
        title="Not found"
        message="Project not found."
        backHref="/"
        backLabel="← All projects"
        playgroundUrl={pg}
      />,
      { title: "Not found — Wana" }
    );
  }
  const role = await getProjectRoleForUser(c.env.DB_CONTROL, uid, projectId);
  if (!role) return c.redirect("/");
  const isAdmin = orgRoleAtLeast(role, "admin");

  const keys = await listApiKeysForProject(c.env.DB_CONTROL, projectId);
  const issuedKey = c.req.query("key") ?? null;
  const err = c.req.query("err") ?? null;

  return c.render(
    <Shell title={`${project.name} — Settings`} playgroundUrl={pg} auth="signed-in">
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
        </Card>
      ) : null}

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
        <Card className="border border-rose-500/30 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-rose-400">
            Danger zone
          </h2>
          <p className="mt-2 text-sm text-kumo-subtle">
            プロジェクトを削除すると、保存済みの全 issue・event・R2 ペイロード・API
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

projectsRoute.get("/:projectId/issues/:issueId", async (c) => {
  const projectId = c.req.param("projectId");
  const issueId = c.req.param("issueId");
  const uid = getDashboardUserId(c);
  if (!uid) {
    return c.redirect("/login");
  }
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
      />,
      { title: "Not found — Wana" }
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
        title="Not found"
        message="Issue not found."
        backHref={`/p/${projectId}`}
        backLabel={`← ${project.name}`}
        playgroundUrl={pg}
      />,
      { title: "Not found — Wana" }
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
  const parsedPayload = payloadPreview
    ? parseStoredEventPayload(payloadPreview)
    : null;

  const statusFormBase = `/p/${projectId}/issues/${issueId}/status`;

  return c.render(
    <Shell title={issue.value} playgroundUrl={pg} auth="signed-in">
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
              <span className="font-mono text-xs text-kumo-subtle">{issue.id}</span>
            </div>
          </div>
        }
      />

      <div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
            Status
          </div>
          <div className="mt-2">
            <Badge variant={issueStatusVariant(issue.status)}>
              {issue.status}
            </Badge>
          </div>
          <div className="mt-4">
            <IssueStatusToolbar action={statusFormBase} status={issue.status} />
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
            Events
          </div>
          <div className="mt-2 text-2xl font-semibold tabular-nums text-kumo-default">
            {issue.eventsCount}
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
            First seen
          </div>
          <div className="mt-2 text-sm tabular-nums text-kumo-default">
            {formatIssueDetailTime(new Date(issue.firstSeen).getTime())}
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
            Last seen
          </div>
          <div className="mt-2 text-sm tabular-nums text-kumo-default">
            {formatIssueDetailTime(new Date(issue.lastSeen).getTime())}
          </div>
        </Card>
      </div>

      <Card className="mb-10 p-5">
        <div className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
          Fingerprint
        </div>
        <div className="mt-2 break-all font-mono text-xs leading-relaxed text-kumo-subtle">
          {issue.fingerprint}
        </div>
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
                  <span className="font-mono text-kumo-default">{e.id}</span>
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
          <EventPayloadView payload={parsedPayload} />
        </Card>
      ) : null}

      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
        Raw JSON payload (stored object)
      </h2>
      <Card className="overflow-hidden">
        {payloadPreview ? (
          <details>
            <summary className="cursor-pointer px-5 py-3 text-sm text-kumo-subtle hover:text-kumo-default sm:px-6">
              {parsedPayload
                ? "Show raw stored JSON"
                : "Stored JSON (could not parse as a Sentry event)"}
            </summary>
            <pre className="max-h-112 overflow-auto border-t border-kumo-hairline p-5 font-mono text-xs leading-relaxed text-kumo-default sm:p-6">
              {payloadPreview}
            </pre>
          </details>
        ) : (
          <p className="p-6 text-sm text-kumo-subtle">
            No payload in R2 for the latest event (key missing or not synced).
          </p>
        )}
      </Card>
    </Shell>,
    { title: `${issue.value} — Wana` }
  );
});

export default projectsRoute;
